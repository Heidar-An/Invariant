import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import type { StateMachineInvariant, StateMachineSchema } from "../contracts/state-machine-schema.js";

export async function discoverStateMachineFromSource(filePath: string): Promise<StateMachineSchema> {
  const sourceText = await readFile(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const context: DiscoveryContext = {
    sourceFile,
    machineName: undefined,
    machineDescription: undefined,
    initialValue: undefined,
    invariants: undefined,
    reducer: undefined,
  };

  for (const statement of sourceFile.statements) {
    if (!isExported(statement)) {
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      collectExportedVariables(statement, context);
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name?.text === "reducer") {
      context.reducer = statement;
    }
  }

  const machineName = context.machineName ?? inferMachineNameFromPath(filePath);
  const machineDescription = context.machineDescription ?? `${machineName} discovered from reducer source.`;
  const initialValue = context.initialValue ?? fail("Expected exported const initialState = { value: <number> }.", sourceFile);
  const invariants = context.invariants ?? fail("Expected exported const invariants = [{ name, description, expression }].", sourceFile);
  const reducer = context.reducer ?? fail("Expected exported function reducer(state, action) { ... }.", sourceFile);
  const actions = parseReducerActions(reducer, sourceFile);

  return {
    name: machineName,
    description: machineDescription,
    sourceFile: path.relative(process.cwd(), filePath),
    discoveryPattern: "single-field-switch-reducer",
    initialState: {
      value: initialValue,
    },
    actions,
    invariants,
  };
}

type DiscoveryContext = {
  sourceFile: ts.SourceFile;
  machineName: string | undefined;
  machineDescription: string | undefined;
  initialValue: number | undefined;
  invariants: StateMachineInvariant[] | undefined;
  reducer: ts.FunctionDeclaration | undefined;
};

function collectExportedVariables(statement: ts.VariableStatement, context: DiscoveryContext): void {
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) {
      continue;
    }

    const exportName = declaration.name.text;
    const initializer = declaration.initializer ? unwrapExpression(declaration.initializer) : undefined;
    if (!initializer) {
      continue;
    }

    if (exportName === "machineName") {
      context.machineName = requireStringLiteral(initializer, "machineName");
      continue;
    }

    if (exportName === "machineDescription") {
      context.machineDescription = requireStringLiteral(initializer, "machineDescription");
      continue;
    }

    if (exportName === "initialState") {
      context.initialValue = parseInitialState(initializer, context.sourceFile);
      continue;
    }

    if (exportName === "invariants") {
      context.invariants = parseInvariants(initializer, context.sourceFile);
    }
  }
}

function parseInitialState(node: ts.Expression, sourceFile: ts.SourceFile): number {
  node = unwrapExpression(node);
  if (!ts.isObjectLiteralExpression(node)) {
    return fail("initialState must be an object literal.", sourceFile, node);
  }

  const valueProperty = getNamedProperty(node, "value", sourceFile);
  return requireNumberLiteral(valueProperty.initializer, "initialState.value", sourceFile);
}

function parseInvariants(node: ts.Expression, sourceFile: ts.SourceFile): StateMachineInvariant[] {
  node = unwrapExpression(node);
  if (!ts.isArrayLiteralExpression(node)) {
    return fail("invariants must be an array literal.", sourceFile, node);
  }

  return node.elements.map((element) => {
    element = unwrapExpression(element);
    if (!ts.isObjectLiteralExpression(element)) {
      return fail("Each invariant must be an object literal.", sourceFile, element);
    }

    const name = requireStringLiteral(getNamedProperty(element, "name", sourceFile).initializer, "invariants[].name");
    const description = requireStringLiteral(
      getNamedProperty(element, "description", sourceFile).initializer,
      "invariants[].description",
    );
    const expression = requireStringLiteral(
      getNamedProperty(element, "expression", sourceFile).initializer,
      "invariants[].expression",
    );

    return { name, description, expression };
  });
}

function parseReducerActions(reducer: ts.FunctionDeclaration, sourceFile: ts.SourceFile): StateMachineSchema["actions"] {
  if (!reducer.body) {
    return fail("Reducer function must have a body.", sourceFile, reducer);
  }

  if (reducer.parameters.length < 2) {
    return fail("Reducer must accept (state, action).", sourceFile, reducer);
  }

  const [stateParam, actionParam] = reducer.parameters;
  const stateName = ts.isIdentifier(stateParam.name) ? stateParam.name.text : fail("Reducer state parameter must be an identifier.", sourceFile, stateParam);
  const actionName = ts.isIdentifier(actionParam.name) ? actionParam.name.text : fail("Reducer action parameter must be an identifier.", sourceFile, actionParam);

  const statements = reducer.body.statements;
  if (statements.length === 0 || !ts.isSwitchStatement(statements[0])) {
    return fail("Reducer must start with switch(action.type).", sourceFile, reducer.body);
  }

  const switchStatement = statements[0];
  if (!isActionTypeExpression(switchStatement.expression, actionName)) {
    return fail("Reducer switch must target action.type.", sourceFile, switchStatement.expression);
  }

  const actions: StateMachineSchema["actions"] = [];
  for (const clause of switchStatement.caseBlock.clauses) {
    if (ts.isDefaultClause(clause)) {
      continue;
    }

    if (!ts.isStringLiteral(clause.expression)) {
      return fail("Reducer case labels must be string literals.", sourceFile, clause.expression);
    }

    const actionType = clause.expression.text;
    const returnStatement = clause.statements.find(ts.isReturnStatement);
    if (!returnStatement?.expression) {
      return fail(`Reducer case "${actionType}" must return a next state.`, sourceFile, clause);
    }

    const delta = parseDeltaFromReturn(returnStatement.expression, stateName, sourceFile);
    actions.push({
      name: sanitizeActionName(actionType),
      delta,
      description: `Discovered from reducer case "${actionType}".`,
    });
  }

  if (actions.length === 0) {
    return fail("Reducer must contain at least one explicit case.", sourceFile, reducer);
  }

  return actions;
}

function parseDeltaFromReturn(node: ts.Expression, stateName: string, sourceFile: ts.SourceFile): number {
  node = unwrapExpression(node);
  if (ts.isIdentifier(node) && node.text === stateName) {
    return 0;
  }

  if (!ts.isObjectLiteralExpression(node)) {
    return fail("Reducer cases must return either state or { value: ... }.", sourceFile, node);
  }

  const valueProperty = getNamedProperty(node, "value", sourceFile);
  const expression = unwrapExpression(valueProperty.initializer);

  if (isStateValueReference(expression, stateName)) {
    return 0;
  }

  if (!ts.isBinaryExpression(expression)) {
    return fail("Reducer value updates must be of the form state.value +/- <integer>.", sourceFile, expression);
  }

  if (!isStateValueReference(expression.left, stateName)) {
    return fail("Reducer value updates must start from state.value.", sourceFile, expression.left);
  }

  const amount = requireNumberLiteral(expression.right, "reducer delta", sourceFile);
  if (expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return amount;
  }

  if (expression.operatorToken.kind === ts.SyntaxKind.MinusToken) {
    return -amount;
  }

  return fail("Reducer value updates must use + or -.", sourceFile, expression.operatorToken);
}

function isActionTypeExpression(node: ts.Expression, actionName: string): boolean {
  return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === actionName && node.name.text === "type";
}

function isStateValueReference(node: ts.Expression, stateName: string): boolean {
  return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === stateName && node.name.text === "value";
}

function getNamedProperty(node: ts.ObjectLiteralExpression, propertyName: string, sourceFile: ts.SourceFile): ts.PropertyAssignment {
  const property = node.properties.find((candidate) => {
    return ts.isPropertyAssignment(candidate) && getPropertyName(candidate.name) === propertyName;
  });

  if (!property || !ts.isPropertyAssignment(property)) {
    return fail(`Expected property "${propertyName}".`, sourceFile, node);
  }

  return property;
}

function getPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }

  return undefined;
}

function requireStringLiteral(node: ts.Expression, fieldName: string): string {
  node = unwrapExpression(node);
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) {
    throw new Error(`${fieldName} must be a string literal.`);
  }

  return node.text;
}

function requireNumberLiteral(node: ts.Expression, fieldName: string, sourceFile: ts.SourceFile): number {
  node = unwrapExpression(node);
  if (!ts.isNumericLiteral(node)) {
    return fail(`${fieldName} must be a numeric literal.`, sourceFile, node);
  }

  return Number(node.text);
}

function inferMachineNameFromPath(filePath: string): string {
  const basename = path.basename(filePath).replace(/\.[^.]+$/, "");
  return basename
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

function sanitizeActionName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9]+/g, " ").trim();
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

function isExported(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return unwrapExpression(node.expression);
  }

  if (ts.isParenthesizedExpression(node)) {
    return unwrapExpression(node.expression);
  }

  return node;
}

function fail(message: string, sourceFile: ts.SourceFile, node?: ts.Node): never {
  if (!node) {
    throw new Error(`${message} In ${sourceFile.fileName}.`);
  }

  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  throw new Error(`${message} In ${sourceFile.fileName}:${line + 1}:${character + 1}.`);
}
