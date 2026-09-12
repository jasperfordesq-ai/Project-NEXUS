// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { setJvmArgs, JVM_ARGS } = require('./with-android-gradle-memory');

// The shape @expo/config-plugins passes to withGradleProperties: a flat list of
// comment and property records, in file order.
const template = () => [
  { type: 'comment', value: 'Project-wide Gradle settings.' },
  { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx2048m -XX:MaxMetaspaceSize=512m' },
  { type: 'property', key: 'android.useAndroidX', value: 'true' },
];

describe('with-android-gradle-memory', () => {
  it('replaces the template budget that made R8 run out of heap', () => {
    const out = setJvmArgs(template());
    const jvmargs = out.filter((i) => i.type === 'property' && i.key === 'org.gradle.jvmargs');
    expect(jvmargs).toHaveLength(1);
    expect(jvmargs[0].value).toBe(JVM_ARGS);
    expect(jvmargs[0].value).not.toContain('2048m');
  });

  it('raises the heap rather than lowering it', () => {
    const heap = Number(/-Xmx(\d+)m/.exec(JVM_ARGS)[1]);
    expect(heap).toBeGreaterThan(2048);
  });

  it('leaves every other property alone and in place', () => {
    const out = setJvmArgs(template());
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ type: 'comment', value: 'Project-wide Gradle settings.' });
    expect(out[2]).toEqual({ type: 'property', key: 'android.useAndroidX', value: 'true' });
  });

  it('adds the setting when the template does not have one', () => {
    const out = setJvmArgs([{ type: 'property', key: 'android.useAndroidX', value: 'true' }]);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      type: 'property',
      key: 'org.gradle.jvmargs',
      value: JVM_ARGS,
    });
  });

  it('is idempotent across the prebuild that runs before every release build', () => {
    const once = setJvmArgs(template());
    const twice = setJvmArgs(once);
    expect(twice.filter((i) => i.key === 'org.gradle.jvmargs')).toHaveLength(1);
  });
});
