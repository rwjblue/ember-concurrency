import Ember from 'ember';
import { _makeIteration } from 'ember-concurrency/iteration';
import { _makeIterator } from 'ember-concurrency/iterators';

module('Unit: Iterations');

function * oneTwoThree() {
  yield 1;
  yield 2;
  yield 3;
}

test("stepping through a Iteration", function(assert) {
  assert.expect(5);

  let iterator = _makeIterator(oneTwoThree, {}, []);
  let outerValue;
  let iteration = _makeIteration(iterator, null, null, v => {
    outerValue = v;
  });

  Ember.run(iteration, 'step', 0);
  assert.deepEqual(outerValue, { index: 1, done: false, value: 1 });
  Ember.run(iteration, 'step', 1);
  assert.deepEqual(outerValue, { index: 2, done: false, value: 2 });
  Ember.run(iteration, 'step', 2);
  assert.deepEqual(outerValue, { index: 3, done: false, value: 3 });
  Ember.run(iteration, 'step', 3);
  assert.deepEqual(outerValue, { index: 4, done: true, value: undefined });
  Ember.run(iteration, 'step', 4);
  assert.deepEqual(outerValue, { index: 5, done: true, value: undefined });
});

test("Iterations let you .redo() the same element over and over", function(assert) {
  assert.expect(9);

  let iterator = _makeIterator(oneTwoThree, {}, []);
  let outerValue;
  let iteration = _makeIteration(iterator, null, null, v => {
    outerValue = v;
  });

  Ember.run(iteration, 'step', 0);
  assert.deepEqual(outerValue, { index: 1, done: false, value: 1 });
  Ember.run(iteration, 'redo', 1);
  assert.deepEqual(outerValue, { index: 2, done: false, value: 1 });
  Ember.run(iteration, 'redo', 2);
  assert.deepEqual(outerValue, { index: 3, done: false, value: 1 });
  Ember.run(iteration, 'redo', 3);
  assert.deepEqual(outerValue, { index: 4, done: false, value: 1 });
  Ember.run(iteration, 'step', 4);
  assert.deepEqual(outerValue, { index: 5, done: false, value: 2 });
  Ember.run(iteration, 'step', 5);
  assert.deepEqual(outerValue, { index: 6, done: false, value: 3 });
  Ember.run(iteration, 'step', 6);
  assert.deepEqual(outerValue, { index: 7, done: true, value: undefined });
  Ember.run(iteration, 'step', 7);
  assert.deepEqual(outerValue, { index: 8, done: true, value: undefined });
  Ember.run(iteration, 'redo', 8);
  assert.deepEqual(outerValue, { index: 9, done: true, value: undefined });
});

test("Iterations let you .break() out of iteration", function(assert) {
  assert.expect(4);

  let iterator = _makeIterator(oneTwoThree, {}, []);
  let outerValue;
  let iteration = _makeIteration(iterator, null, null, v => {
    outerValue = v;
  });

  Ember.run(iteration, 'step', 0);
  assert.deepEqual(outerValue, { index: 1, done: false, value: 1 });
  Ember.run(iteration, 'step', 1);
  assert.deepEqual(outerValue, { index: 2, done: false, value: 2 });
  Ember.run(iteration, 'break', 2);
  assert.deepEqual(outerValue, { index: 3, done: true, value: undefined });
  Ember.run(iteration, 'step', 3);
  assert.deepEqual(outerValue, { index: 4, done: true, value: undefined });
});

test("Iterations ignore stepping functions if the wrong index is passed in", function(assert) {
  assert.expect(2);

  let iterator = _makeIterator(oneTwoThree, {}, []);
  let currentExpectedValue;
  let iteration = _makeIteration(iterator, null, null, v => {
    if (!currentExpectedValue) {
      assert.ok(false, "step function shouldn't have run");
    } else {
      assert.deepEqual(v, currentExpectedValue);
    }
  });

  let runAndExpect = (stepFnName, index, expectedValue) => {
    currentExpectedValue = expectedValue;
    Ember.run(iteration, stepFnName, index);
  };

  runAndExpect('step',  1, false);
  runAndExpect('step', 0, { index: 1, done: false, value: 1 });
  runAndExpect('step',  -2, false);
  runAndExpect('step', 0, false);
  runAndExpect('step', 1, { index: 2, done: false, value: 2 });
  runAndExpect('break', 0, false);
  runAndExpect('redo', 0, false);
});

test("Iterations ignore stepping functions always step on -1 index", function(assert) {
  assert.expect(1);

  let iterator = _makeIterator(oneTwoThree, {}, []);
  let arr = [];
  let iteration = _makeIteration(iterator, null, null, ({ done, value }) => {
    if (!done) { arr.push(value); }
  });

  Ember.run(iteration, 'step', -1);
  Ember.run(iteration, 'step', -1);
  Ember.run(iteration, 'step', -1);
  Ember.run(iteration, 'step', -1);
  Ember.run(iteration, 'step', -1);
  assert.deepEqual(arr, [1,2,3]);
});

test(".step() accepts a value that it passes back into the iteratable", function(assert) {
  assert.expect(2);

  function * foo () {
    assert.equal('a', yield);
    assert.equal('b', yield);
  }

  let iterator = _makeIterator(foo, {}, []);
  let iteration = _makeIteration(iterator, null, null, Ember.K);

  Ember.run(iteration, 'step', 0, undefined);
  Ember.run(iteration, 'step', 1, 'a');
  Ember.run(iteration, 'step', 2, 'b');
});

test(".registerDisposable", function(assert) {
  assert.expect(4);

  let iterator = _makeIterator(oneTwoThree, {}, []);
  let iteration = _makeIteration(iterator, null, null, Ember.K);

  let arr = [];
  Ember.run(() => {
    iteration.registerDisposable(0, { dispose() { arr.push('a'); this.dispose = null; } });
    iteration.registerDisposable(0, { dispose() { arr.push('b'); this.dispose = null; } });
    iteration.registerDisposable(0, { dispose() { arr.push('c'); this.dispose = null; } });
  });
  assert.deepEqual(arr, []);
  Ember.run(iteration, 'step', 5, undefined);
  assert.deepEqual(arr, []);
  Ember.run(iteration, 'step', 6, undefined);
  iteration.step(6, undefined);
  Ember.run(iteration, 'step', 0, undefined);
  assert.deepEqual(arr, ['a', 'b', 'c']);
  Ember.run(iteration, 'step', 1, undefined);
  assert.deepEqual(arr, ['a', 'b', 'c']);
});

