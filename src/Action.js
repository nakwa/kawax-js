import _ from 'lodash';
import uuid from 'uuid';
import Smart from './Smart';
import Runtime from './Runtime';
import resolve from './helpers/resolve';
import log from './helpers/log';

class Action extends Smart {

  static actionCreators = {};

  static type = '__UNDEFINED__';

  defaults(context = {}) {
    return ({
      status: 'pending',
      context
    });
  }

  parsePayload = (payload) => payload;

  pendingPayload = (data) => data;

  payload = (payload, data) => payload;

  error = (error, data) => ({ message: 'Oops, something went wrong', ...error });

  setStatus = (status) => { this.status = status; };

  export = (payload) => ({
    payload: this._parsePayload(payload),
    type: this.constructor.type,
    timestamp: this.timestamp,
    options: this.options,
    status: this.status,
    uuid: this.uuid,
    ...this.context
  });

  _parsePayload(payload) {
    return resolve.call(this, this.parsePayload, payload);
  }

  _call(data, { success, error, ...options } = {}) {
    this.uuid = uuid();
    this.timestamp = Date.now();
    this._successCallback = success;
    this._errorCallback = error;
    return (dispatch, getState) => {
      this.extend({ options });
      this._setGetState(getState);
      this._dispatchPending(dispatch, data);
      new Promise(async () => { /* eslint-disable-line no-new */
        this._bindActionsCreators(dispatch, getState);
        const payload = await this._processPayload(data, options);
        await dispatch(this.export(payload, data));
        await this._afterDispatch(payload, data);
      });
      return this.uuid;
    };
  }

  _setGetState(getState) {
    this.getState = (...map) => {
      const state = getState();
      const path = (map.length === 1 ? map[0] : map);
      return _.get(state, path);
    };
  }

  _dispatchPending(dispatch, data) {
    this.setStatus('pending');
    const pendingPayload = resolve.call(this, this.pendingPayload, data);
    dispatch(this.export(pendingPayload, data));
  }

  _bindActionsCreators(dispatch, getState) {
    const actionCreators = this.constructor.actionCreators;
    _.each(actionCreators, (action, key) => {
      if (typeof action === 'function') {
        this[key] = (data, context = {}) => new Promise((success, error) => {
          action(data, { success, error, ...context })(dispatch, getState);
        });
      }
    });
  }

  async _processPayload(data, options) {
    if (typeof this.call === 'function') {
      try {
        const payload = await this.call(data, options);
        return await this._processSuccess(payload, data);
      } catch (exception) {
        if (exception instanceof Error) log.error(exception);
        const error = (exception instanceof Error) ? {} : exception;
        return this._processError(error, data);
      }
    } else if (this.call !== undefined) {
      return this.call;
    }
    return this._processSuccess(data);
  }

  async _afterDispatch(payload, data) {
    if (this.status === 'success') {
      await resolve.call(this, this._successCallback, payload);
      resolve.call(this, this.afterDispatch, payload, data);
    } else {
      resolve.call(this, this._errorCallback, payload);
    }
  }

  async _processSuccess(payload, data) {
    this.setStatus('success');
    const success = resolve.call(this, this.payload, payload, data);
    await resolve.call(this, this.onSuccess, payload, data);
    return success;
  }

  async _processError(payload, data) {
    this.setStatus('error');
    const error = resolve.call(this, this.error, payload, data);
    await resolve.call(this, this.onError, error, data);
    return error;
  }

  static bind(context) {
    const action = this.export(context);
    return (data, options = {}) => new Promise((success, error) => {
      const { dispatch, getState } = Runtime('store');
      action(data, { success, error, ...options })(dispatch, getState);
    });
  }

}

export default Action;