import _ from 'lodash';
import uuid from 'uuid';
import Smart from './Smart';
import Runtime from './Runtime';
import resolve from './helpers/resolve';
import select from './helpers/select';
import Log from './helpers/log';

class Action extends Smart {

  static actionCreators = {};

  static type = false;

  static warnOnClose = false;

  static defaults = (options) => ({
    context: options,
  });

  static reducer = false;

  static cache = false;

  constructor({ success, error, log, origin, cache, ...context }) {
    super(context);
    this.id = uuid();
    this.onError = error;
    this.onSuccess = success;
    this.log = log || true;
    this.origin = origin || false;
    this._context = context;
    this._shouldCache = this.static.cache || !!cache;
  }

  pendingPayload = (data) => {};

  successPayload = (data) => (success) => success;

  errorPayload = (data) => (error) => error;

  payload = (data) => (payload) => payload;

  pendingNotice = (data) => false;

  successNotice = (data) => (success) => false;

  errorNotice = (data) => (error) => false;

  notice = (data) => (payload) => false;

  setStatus = (status) => { this.status = status; };

  export = (action, ...data) => action;

  _export = async (payload, ...data) => {
    const parsedPayload = await this._parsePayload(payload, ...data);
    return this.export({
      id: this.id,
      log: this.log,
      origin: this.origin,
      payload: parsedPayload,
      status: this.status,
      timestamp: this.timestamp,
      class: this.constructor.name,
      type: this.static.type || this._getType(),
      notice: await this._parseNotice(payload, ...data) || false,
      context: await this._parseContext(payload, ...data) || false,
      reducer: this.static.reducer || false,
    }, ...data);
  };

  _getType = () => {
    const snakeCase = _.snakeCase(this.constructor.name);
    return `~${_.toUpper(snakeCase)}`;
  };

  _resolve = async (callback, payload, ...data) => {
    const shallow = await resolve.call(this, callback, ...data);
    return resolve.call(this, shallow, payload);
  };

  async _parseContext(payload = {}, ...data) {
    const parsedContext = await this._resolve(this.context, payload, ...data) || {};
    return _.isPlainObject(this._context) ? { ...parsedContext, ...this._context } : parsedContext;
  }

  async _parsePayload(payload, ...data) {
    return this._resolve(this.payload, payload, ...data) || false;
  }

  async _parseNotice(payload = {}, ...data) {
    let notice;
    if (this.status === 'pending') notice = await this._resolve(this.pendingNotice, payload, ...data);
    else if (this.status === 'error') notice = await this._resolve(this.errorNotice, payload, ...data);
    else if (this.status === 'success') notice = await this._resolve(this.successNotice, payload, ...data);
    const finalNotice = await this._resolve(this.notice, notice, ...data);
    const defaultMessage = (this.status === 'error') ? 'An error has occured.' : String();
    return !notice && !finalNotice ? false : {
      message: payload.message || defaultMessage,
      ...notice,
      ...finalNotice,
    };
  }

  _getCachedPayload = (...data) => {
    if (this._shouldCache) {
      const cache = resolve.call(this, this.cache, ...data);
      if (cache && !_.isEmpty(cache)) {
        this.setStatus('success');
        return cache;
      }
    }
    return false;
  };

  run(...data) {
    this._setWindowUnloadListener();
    this.timestamp = Date.now();
    return (dispatch, getState) => {
      this._getState = getState;
      this._dispatch = dispatch;
      this._defineGetState();
      this._defineSetContext(...data);
      this._defineDispatchSuccess(...data);
      new Promise(async (success) => { /* eslint-disable-line no-new */
        try {
          this._bindActionsCreators(...data);
          await this._bindResources(...data);
          await this._dispatchPending(...data);
          const cache = this._getCachedPayload(...data);
          const payload = cache || await this._processPayload(...data);
          const action = await this._export(payload, ...data);
          await this._beforeDispatch(payload, ...data);
          await dispatch(action);
          if (this.status === 'success') {
            await resolve.call(this, this.onSuccess, payload, ...data);
          } else {
            await resolve.call(this, this.onError, payload, ...data);
          }
          await this._afterDispatch(payload, ...data);
          this._removeWindowUnloadListener();
          success();
        } catch (exception) {
          Log.error(exception);
          this.setStatus('error');
          return exception;
        }
      });
      return this.id;
    };
  }

  _defineSetContext = async (...data) => {
    this.setContext = async (context = {}) => {
      _.extend(this._context, context);
      const action = await this._export({}, ...data);
      return this._dispatch(action);
    };
  };

  _defineGetState() {
    this.getState = (...args) => {
      const path = (args.length > 1 ? args : args[0]);
      const state = this._getState();
      return select(state, path);
    };
  }

  _defineDispatchSuccess = async (...data) => {
    this.dispatchSuccess = async (payload) => {
      this.setStatus('success');
      const action = await this._export(payload, ...data);
      return this._dispatch(action);
    };
  };

  async _dispatchPending(...data) {
    this.setStatus('pending');
    const pendingPayload = this._resolve(this.pendingPayload, {}, ...data);
    const action = await this._export(pendingPayload, ...data);
    this._dispatch(action);
  }

  async _bindResources(...data) {
    const resources = resolve.call(this, this.static.resources, ...data);
    _.each(resources, (resource, key) => {
      if (typeof resource === 'function') {
        this[key] = (options, ...override) => resource(options, {
          actionId: this.id,
          type: this.constructor.type,
          ...this.context,
          ..._.last(data),
          ...override,
        });
      }
    });
  }

  _bindActionsCreators(...ownData) {
    const actionCreators = resolve.call(this, this.constructor.actionCreators, ...ownData);
    _.each(actionCreators, (action, key) => {
      if (typeof action === 'function') {
        this[key] = (...data) => new Promise(async (success, error) => {
          const actionInstance = action({
            origin: this.constructor.name,
            success: success,
            error: error,
          });
          await actionInstance._setState(...data);
          actionInstance.run(...data)(this._dispatch, this._getState);
        });
      }
    });
  }

  async _processPayload(...data) {
    if (typeof this.call === 'function') {
      try {
        const call = await this.call(...data);
        const payload = await resolve(call);
        this.setStatus('success');
        return this._resolve(this.successPayload, payload, ...data);
      } catch (exception) {
        if (exception instanceof Error) Log.error(exception);
        this.setStatus('error');
        return this._resolve(this.errorPayload, exception, ...data);
      }
    } else if (this.call !== undefined) {
      return this.call;
    }
    return this._processSuccess(data);
  }

  async _processSuccess(payload, data) {
    this.setStatus('success');
    return this._resolve(this.successPayload, payload, ...data);
  }

  async _processError(payload, ...data) {
    this.setStatus('error');
    return this._resolve(this.errorPayload, payload, ...data);
  }

  async _beforeDispatch(payload, ...data) {
    if (this.status === 'success') {
      await this._resolve(this.beforeDispatch, payload, ...data);
    } else if (this.status === 'error') {
      await this._resolve(this.beforeRescue, payload, ...data);
    }
  }

  async _afterDispatch(payload, ...data) {
    if (this.status === 'success') {
      await this._resolve(this.afterDispatch, payload, ...data);
    } else if (this.status === 'error') {
      await this._resolve(this.afterRescue, payload, ...data);
    }
  }

  async _setState(...args) {
    this.state = await resolve.call(this, this.state, ...args);
  }

  _setWindowUnloadListener() {
    if (this.constructor.warnOnClose) {
      window.addEventListener('beforeunload', this._handleWindowUnloadEvent);
    }
  }

  _removeWindowUnloadListener() {
    if (this.constructor.warnOnClose) {
      window.removeEventListener('beforeunload', this._handleWindowUnloadEvent);
    }
  }

  _handleWindowUnloadEvent(event) {
    const dialogText = 'Changes you made may not be saved!';
    event.returnValue = dialogText;
    return dialogText;
  }

  static bind(context) {
    return (...data) => new Promise(async (success, error) => {
      const { dispatch, getState } = Runtime('store');
      const action = new this({ success, error, ...context });
      await action._setState(...data);
      action.run(...data)(dispatch, getState);
    });
  }

}

export default Action;
