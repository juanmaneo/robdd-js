"use strict";

const pa     = require('pimped-assert'),
      assert = pa.assert,
      refute = pa.refute;

/* module under test: */
const BDD = require('../lib/BDD'),
      T   = BDD.True,
      F   = BDD.False,
      ite = BDD.ite;


() => {
    refute.same(T, F, "BDD.True is different from BDD.False");

    assert.same(ite(F, T, T), T);
    assert.same(ite(F, T, F), F);
    assert.same(ite(F, F, T), T);
    assert.same(ite(F, F, F), F);
    assert.same(ite(T, T, T), T);
    assert.same(ite(T, T, F), T);
    assert.same(ite(T, F, T), F);
    assert.same(ite(T, F, F), F);

    assert.same(F.neg, T);
    assert.same(T.neg, F);

    assert.same(F.not(), T);
    assert.same(T.not(), F);
}();

/* BDD.size */
() => {
    let a = BDD.var('a'),
        b = BDD.var('b');
    [
        [T                 ,    1],
        [a                 ,    3],
        [b                 ,    3],
        [ite(a, b, T)      ,    4],
        [ite(a, b, F)      ,    4],
        [ite(a, b, b.not()),    5],
    ].forEach(arr => {
        let bdd  = arr[0];
        let size = arr[1];
        assert.same(bdd      .size(), size);
        assert.same(bdd.not().size(), size);
    });
}();
