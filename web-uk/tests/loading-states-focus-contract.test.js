// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

/**
 * `loading-states.js` used to set `button.disabled = true` on submit. That
 * drops focus to <body> (a disabled control cannot hold focus) AND suppresses
 * the announcement of the button's new accessible name — so a screen-reader or
 * keyboard user got no signal at all that their submission was in flight. GDS
 * says plainly that submit buttons should not be disabled, a position this
 * codebase already states in `public/js/password-strength.js`.
 *
 * The replacement keeps the control focusable (`aria-disabled` + `aria-busy`)
 * and prevents double submission with a form-level guard. The test EXECUTES the
 * script against a minimal DOM stub rather than grepping its source, so it
 * proves the behaviour and not the wording.
 */
const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'loading-states.js'),
  'utf8'
);

function makeElement(tagName, attrs = {}) {
  const element = {
    tagName,
    dataset: {},
    classList: {
      _set: new Set(),
      add(name) { this._set.add(name); },
      remove(name) { this._set.delete(name); },
      contains(name) { return this._set.has(name); }
    },
    attributes: { ...attrs },
    disabled: false,
    textContent: 'Sign in',
    innerHTML: '',
    children: [],
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
    removeAttribute(name) { delete this.attributes[name]; },
    appendChild(child) { this.children.push(child); return child; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    remove() {}
  };
  return element;
}

function runScript() {
  const button = makeElement('BUTTON');
  const submitHandlers = [];
  const form = makeElement('FORM');
  form.dataset.loading = 'Signing in…';
  form.querySelector = () => button;
  form.addEventListener = (type, handler) => {
    if (type === 'submit') submitHandlers.push(handler);
  };

  const document = {
    readyState: 'complete',
    addEventListener() {},
    createElement: (tag) => makeElement(tag.toUpperCase()),
    createTextNode: (text) => ({ text }),
    querySelectorAll(selector) {
      // Only the form-enhancement selector needs to match.
      return selector === 'form[data-loading]' ? [form] : [];
    },
    body: makeElement('BODY')
  };
  const window = { addEventListener() {} };
  const context = {
    document,
    window,
    setTimeout: () => 0,
    clearTimeout: () => {},
    console
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);

  return { button, form, submit: submitHandlers[0], api: window.NEXUSLoading };
}

describe('submit-button loading state keeps the control focusable', () => {
  it('never disables the submit button, and marks it busy instead', () => {
    const { button, submit } = runScript();
    expect(typeof submit).toBe('function');

    submit({ defaultPrevented: false, preventDefault() {} });

    // The whole point: focus stays on a control that is still in the tab order.
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.classList.contains('app-button--loading')).toBe(true);
    // The new name is announceable precisely because the button is not disabled.
    expect(button.getAttribute('aria-label')).toBe('Signing in…');
  });

  it('blocks a second submission with a form guard rather than a disabled control', () => {
    const { form, submit } = runScript();

    submit({ defaultPrevented: false, preventDefault() {} });
    expect(form.dataset.submitting).toBe('true');

    let prevented = false;
    submit({ defaultPrevented: false, preventDefault() { prevented = true; } });
    expect(prevented).toBe(true);
  });

  it('does not show a loading state when validation already blocked the submit', () => {
    const { button, submit } = runScript();

    submit({ defaultPrevented: true, preventDefault() {} });

    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.classList.contains('app-button--loading')).toBe(false);
  });

  it('restores the button when the loading state is cleared', () => {
    const { button, submit, api } = runScript();

    submit({ defaultPrevented: false, preventDefault() {} });
    api.clearButtonLoading(button);

    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.classList.contains('app-button--loading')).toBe(false);
  });
});
