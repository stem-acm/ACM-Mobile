import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildEnvironment, normalizeUrl, parseArgs } from '../scripts/build-config.js';

const readJson = (name) => JSON.parse(fs.readFileSync(new URL(`../env/${name}`, import.meta.url)));
const baseConfig = readJson('capacitor.base.json');
const envs = { local: readJson('local.json'), staging: readJson('staging.json'), prod: readJson('prod.json') };
const build = (env, api = null) => buildEnvironment(env, { api, envFile: envs[env], baseConfig });

/** Runs the generated config.js as the WebView would and returns window.APP_CONFIG. */
function evalConfig(configJs) {
  const context = { window: {} };
  vm.runInNewContext(configJs, context);
  return context.window.APP_CONFIG;
}

test('base config: appId, appName, webDir, privacy screen off, no androidScheme', () => {
  assert.equal(baseConfig.appId, 'com.stemacm.ipasscheck');
  assert.equal(baseConfig.appName, 'iPass Badge Check');
  assert.equal(baseConfig.webDir, 'src');
  assert.deepEqual(baseConfig.plugins.PrivacyScreen, { enable: false });
  assert.equal(baseConfig.server?.androidScheme, undefined);
});

test('local: emulator URL, LOCAL_BUILD true, cleartext and mixed content on', () => {
  const { configJs, capacitorConfig } = build('local');
  const config = evalConfig(configJs);
  assert.deepEqual({ ...config }, {
    API_BASE_URL: 'http://10.0.2.2:5002',
    ENV_NAME: 'local',
    LOCAL_BUILD: true,
  });
  assert.ok(Object.isFrozen(config));
  assert.equal(capacitorConfig.server.cleartext, true);
  assert.equal(capacitorConfig.android.allowMixedContent, true);
  assert.equal(capacitorConfig.appId, 'com.stemacm.ipasscheck');
});

test('local with --api: the LAN URL replaces the emulator URL', () => {
  const config = evalConfig(build('local', 'http://192.168.1.20:5002/').configJs);
  assert.equal(config.API_BASE_URL, 'http://192.168.1.20:5002');
});

test('staging: staging URL, LOCAL_BUILD false, no cleartext, no mixed content', () => {
  const { configJs, capacitorConfig } = build('staging');
  const config = evalConfig(configJs);
  assert.equal(config.API_BASE_URL, 'https://ipass-staging.srv2134605.hstgr.cloud');
  assert.equal(config.ENV_NAME, 'staging');
  assert.equal(config.LOCAL_BUILD, false);
  assert.equal(capacitorConfig.server?.cleartext, undefined);
  assert.equal(capacitorConfig.android?.allowMixedContent, undefined);
});

test('prod: production URL and name, no cleartext, no mixed content', () => {
  const { configJs, capacitorConfig } = build('prod');
  const config = evalConfig(configJs);
  assert.equal(config.API_BASE_URL, 'https://ipass.srv2134605.hstgr.cloud');
  assert.equal(config.ENV_NAME, 'production');
  assert.equal(config.LOCAL_BUILD, false);
  assert.equal(JSON.stringify(capacitorConfig).includes('cleartext'), false);
  assert.equal(JSON.stringify(capacitorConfig).includes('allowMixedContent'), false);
});

test('build:prod --api http://… fails', () => {
  assert.throws(() => build('prod', 'http://10.0.2.2:5002'), /only accepted for the local build/);
});

test('build:staging --api fails, even with https', () => {
  assert.throws(() => build('staging', 'https://example.org'), /only accepted for the local build/);
});

test('staging or prod with an http URL in the env file is refused', () => {
  for (const env of ['staging', 'prod']) {
    const envFile = { ...envs[env], apiBaseUrl: 'http://ipass.example.org' };
    assert.throws(
      () => buildEnvironment(env, { envFile, baseConfig }),
      /needs an https:\/\/ API URL/
    );
  }
});

test('the base config file is not changed by a build', () => {
  const before = JSON.stringify(baseConfig);
  build('local');
  build('prod');
  assert.equal(JSON.stringify(baseConfig), before);
});

test('normalizeUrl: trailing slashes removed, bad URLs refused', () => {
  assert.equal(normalizeUrl('https://a.example.org/'), 'https://a.example.org');
  assert.equal(normalizeUrl('http://10.0.2.2:5002'), 'http://10.0.2.2:5002');
  assert.throws(() => normalizeUrl('10.0.2.2:5002'), /http or https|Not a valid URL/);
  assert.throws(() => normalizeUrl('not a url'), /Not a valid URL/);
  assert.throws(() => normalizeUrl('ftp://a.example.org'), /http or https/);
  assert.throws(() => normalizeUrl('https://a.example.org/?x=1'), /query/);
});

test('parseArgs: environment, --api in both forms, --no-sync', () => {
  assert.deepEqual(parseArgs(['local']), { env: 'local', api: null, sync: true });
  assert.deepEqual(parseArgs(['local', '--api', 'http://x:1']), { env: 'local', api: 'http://x:1', sync: true });
  assert.deepEqual(parseArgs(['local', '--api=http://x:1', '--no-sync']), { env: 'local', api: 'http://x:1', sync: false });
});

test('parseArgs: bad input is refused', () => {
  assert.throws(() => parseArgs([]), /must be one of/);
  assert.throws(() => parseArgs(['dev']), /must be one of/);
  assert.throws(() => parseArgs(['local', '--api']), /needs a URL/);
  assert.throws(() => parseArgs(['local', '--force']), /Unknown option/);
  assert.throws(() => parseArgs(['local', 'prod']), /Unexpected argument/);
});
