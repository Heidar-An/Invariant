module __MODULE_NAME__ {
  datatype Model = Model(value: int)
  datatype Action = __ACTION_VARIANTS__

  ghost predicate Inv(m: Model) {
    __INVARIANT_BODY__
  }

  function Init(): Model {
    Model(__INITIAL_VALUE__)
  }

  function Apply(m: Model, a: Action): Model {
    match a
__APPLY_CASES__
  }

  function Normalize(m: Model): Model {
    if m.value < 0 then Model(0) else m
  }

  lemma InitSatisfiesInv()
    ensures Inv(Init())
  {
    assert Inv(Init());
  }

  lemma StepPreservesInv(m: Model, a: Action)
    requires Inv(m)
    ensures Inv(Normalize(Apply(m, a)))
  {
    match a
__PROOF_CASES__
  }
}
