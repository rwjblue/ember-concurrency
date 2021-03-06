import Ember from 'ember';

const NO_VALUE_YET = {};
const NEXT   = 'next';
const RETURN = 'return';

let NULL_ITERATION = {
  setBufferPolicy(policy) {
    Ember.assert(`You called ${policy.name} outside of the scope of an iteration (this and similar iteration macros can only be called at the top level of an iteration handler function)`, false);
  },
};

let CURRENT_ITERATION = NULL_ITERATION;

let returnSelf = Ember.K;

function _concurrentInstance(iteration) {
  this.iteration = iteration;
}

_concurrentInstance.prototype.attach = function(iterator) {
  if (iterator.buffer.length) {
    let mostRecent = iterator.buffer.pop();
    iterator.buffer = [mostRecent];
  } else {
    iterator.buffer = [];
  }
};

_concurrentInstance.prototype.concurrent = true;

_concurrentInstance.prototype.put = function(value, iterator) {
  this.iteration.step(-1, undefined);
  iterator.put(value);
};

export let _concurrent = {
  name: 'concurrent',
  concurrent: true,
  create(iteration) {
    return new _concurrentInstance(iteration);
  },
};

//export function concurrent() {
  //CURRENT_ITERATION.setBufferPolicy(_restartable);
//}

export let _enqueue = {
  name: 'enqueue',
  create: returnSelf,
  attach: Ember.K,
  put(value, iterator) {
    iterator.put(value);
  },
};

export let _dropIntermediateValues = {
  name: 'dropIntermediateValues',
  create: returnSelf,
  attach(iterator) {
    if (iterator.takers.length === 0) {
      // drop all buffered values
      iterator.buffer.length = 0;
    }
  },
  put(value, iterator) {
    if (iterator.takers.length > 0) {
      //console.log(`PUTTING ${value}`);
      iterator.put(value);
    } else {
      //console.log(`DROPPING ${value}`);
      // no one's listening for values; just drop.
    }
  },
};

export function dropIntermediateValues() {
  CURRENT_ITERATION.setBufferPolicy(_dropIntermediateValues);
}

export let _keepFirstIntermediateValue = {
  name: 'keepFirstIntermediateValue',
  create: returnSelf,
  attach(iterator) {
    if (iterator.takers.length === 0) {
      if (iterator.buffer.length > 1) {
        // drop all but first buffered values
        iterator.buffer.length = 1;
      }
    }
  },
  put(value, iterator) {
    if (iterator.takers.length > 0) {
      iterator.put(value);
    } else {
      if (iterator.buffer.length === 0) {
        iterator.put(value);
      }
    }
  },
};

export function keepFirstIntermediateValue() {
  CURRENT_ITERATION.setBufferPolicy(_keepFirstIntermediateValue);
}

export let _keepLastIntermediateValue = {
  name: 'keepLastIntermediateValue',
  create: returnSelf,
  attach(iterator) {
    if (iterator.takers.length === 0) {
      if (iterator.buffer.length > 1) {
        // drop all but last buffered values
        iterator.buffer = [iterator.buffer.pop()];
      }
    }
  },
  put(value, iterator) {
    if (iterator.takers.length > 0) {
      iterator.put(value);
    } else {
      iterator.buffer.length = 0;
      iterator.put(value);
    }
  },
};

export function keepLastIntermediateValue() {
  CURRENT_ITERATION.setBufferPolicy(_keepLastIntermediateValue);
}

function _restartableInstance(iteration) {
  this.iteration = iteration;
}

_restartableInstance.prototype.attach = function(iterator) {
  if (iterator.buffer.length) {
    let mostRecent = iterator.buffer.pop();
    iterator.buffer = [mostRecent];
  } else {
    iterator.buffer = [];
  }
};

_restartableInstance.prototype.put = function(value, iterator) {
  this.iteration.step(-1, undefined);
  iterator.put(value);
};

export let _restartable = {
  name: 'restartable',
  create(iteration) {
    return new _restartableInstance(iteration);
  },
};

export function restartable() {
  CURRENT_ITERATION.setBufferPolicy(_restartable);
}

function Iteration(iterator, sourceIteration, bufferPolicy, fn) {
  this.iterator = iterator;
  this.fn = fn;
  this.lastValue = NO_VALUE_YET;
  this.index = 0;
  this.disposables = [];
  this.rootDisposables = [];
  this.stepQueue = [];
  this.sourceIteration = sourceIteration;
  this.setBufferPolicy(bufferPolicy || _concurrent);
}

Iteration.prototype = {
  step(index, nextValue) {
    this._step(NEXT, index, nextValue);
  },

  _step(iterFn, index, nextValue) {
    if (!this._indexValid(index)) { return; }
    this.stepQueue.push([iterFn, nextValue]);
    Ember.run.once(this, this._flushQueue);
  },

  setBufferPolicy(policy) {
    if (this.sourceIteration) {
      this.sourceIteration.setBufferPolicy(policy);
    } else {
      Ember.assert(`The collection you're looping over doesn't support ${policy.name}`, !!this.iterator.setBufferPolicy);
      this.iterator.setBufferPolicy(policy.create(this));
    }
  },

  _flushQueue() {
    this.index++;
    let queue = this.stepQueue;
    if (queue.length === 0) { return; }
    this.stepQueue = [];
    this._disposeDisposables(this.disposables);

    // TODO: add tests around this, particularly when
    // two things give the iteration conflicting instructions.
    let [iterFn, nextValue] = queue.pop();
    if (iterFn) {

      if (iterFn === RETURN) {
        this._disposeDisposables(this.rootDisposables);
      }

      let value;
      try {
        CURRENT_ITERATION = this;
        value = this.iterator[iterFn](nextValue);
      } finally {
        CURRENT_ITERATION = NULL_ITERATION;
      }

      if (value.then) {
        value.then(v => {
          this.lastValue = {
            done: false,
            value: v,
          };
          this._runFunctionWithIndex();
        }, error => {
          throw new Error("not implemented");
        });
        return;
      } else {
        this.lastValue = value;
      }
    }
    this._runFunctionWithIndex();
  },

  redo(index) {
    this._step(null, index);
  },

  break(index) {
    this._step(RETURN, index);
  },

  _runFunctionWithIndex() {
    let result = Object.assign({ index: this.index }, this.lastValue);
    this.fn(result);
  },

  _indexValid(index) {
    return (index === this.index || index === -1);
  },

  registerDisposable(index, disposable, isRootDisposable) {
    if (!this._indexValid(index)) { return; }
    if (isRootDisposable) {
      this.rootDisposables.push(disposable);
    } else {
      this.disposables.push(disposable);
    }
  },

  _disposeDisposables(disposables) {
    for (let i = 0, l = disposables.length; i < l; i++) {
      let d = disposables[i];
      d.dispose();
    }
    disposables.length = 0;
  }
};

export function _makeIteration(iterator, sourceIteration, bufferPolicy, fn) {
  return new Iteration(iterator, sourceIteration, bufferPolicy, fn);
}

