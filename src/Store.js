import { createStore, applyMiddleware, compose } from 'redux';
import _ from 'lodash';
import Thunk from 'redux-thunk';
import Smart from './Smart';
import log from './helpers/log';
import InternalReducer from './instance/InternalReducer';

class Store extends Smart {

  groupLog = false;

  initialize({ reducer, name }) {
    this.internal = this._createInternalStore();
    this.main = this._createMainStore(reducer, name);
    if (__DEV__) {
      this.extend({ pendingActions: [] });
    }
  }

  dispatch = (action) => {
    this.internal.dispatch(action);
    return this.main.dispatch(action);
  };

  subscribe = (listener) => this.main.subscribe(listener);

  replaceReducer = (nextReducer) => this.main.replaceReducer(nextReducer);

  getState = () => this.main.getState();

  getInternalState = () => this.internal.getState();

  _dispatch = (action) => this.internal.dispatch(action);

  _createInternalStore() {
    const enhancer = this._getEnhancer(true);
    const internalReducer = InternalReducer.export();
    return createStore(internalReducer, false, enhancer);
  }

  _createMainStore(reducer = this.reducer) {
    const enhancer = this._getEnhancer();
    return createStore(reducer, false, enhancer);
  }

  _getEnhancer(internal = false) {
    const composer = this._getComposer(internal);
    const middlewares = this._getMiddlewares(internal);
    return composer(middlewares);
  }

  _getComposer(internal = false) {
    if (__DEV__ && global.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__) {
      return global.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({
        name: internal ? 'Kawax Internal' : false,
        latency: 1000,
        maxAge: 25,
      });
    }
    return compose;
  }

  _getMiddlewares(internal = false) {
    const middlewares = [Thunk];
    if (__DEV__ && !internal) {
      middlewares.push(this._logger.bind(this));
    }
    return applyMiddleware(...middlewares);
  }

  _logger({ getState }) {
    return (next) => (action) => {
      let state;
      let duration = null;
      if (action.status === 'pending') {
        state = getState();
        this.pendingActions.push({ id: action.id, startTime: performance.now() });
      }
      const payload = next(action);
      if (action.done) {
        if (action.status !== 'pending') {
          state = getState();
          const [initialAction] = _.remove(this.pendingActions,
            (pendingAction) => pendingAction.id === action.id);
          duration = performance.now() - (initialAction ? initialAction.startTime : 0);
        }
        const output = this._formatLog(state, action, duration);
        const actionPayload = _.cloneDeep(action);
        if (action.status === 'error') {
          log.group(...output);
          log.error('Action:', actionPayload);
          log.groupEnd();
        } else if (action.log && action.status === 'success') {
          log.debug(...output, '\n ', actionPayload);
        }
      }
      return payload;
    };
  }

  _formatLog(state, action, duration) {
    const className = String(action.class);
    const header = String(action.type);
    const status = (action.status ? `${action.status}` : 'no-status');
    const style = action.status === 'error'
      ? 'background: #FFF0F0; color: #FD4146; font-weight: bold;'
      : 'color: black; font-weight: bold;';
    let time = ' ';
    if (duration) {
      time = `${duration >= 1000 ? `${(duration / 1000).toFixed(2)}s` : `${duration.toFixed(0)}ms`}`;
    }
    return [
      `%c${className}: ${status} (${header}) (${time})`,
      style,
    ];
  }

  reducer(state, action) {
    return Object.assign({}, state);
  }

}

export default Store;
