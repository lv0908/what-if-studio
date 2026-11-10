import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('app/index.html', 'utf8');
const match = html.match(/\/\/ EDITOR_DATA_HELPERS_START([\s\S]*?)\/\/ EDITOR_DATA_HELPERS_END/);
assert.ok(match, 'editor data helper section must exist');
const sandbox = {};
vm.runInNewContext(`${match[1]}\nthis.helpers={buildEditorDocument,buildPreviewRequestBody,formatApiError};`, sandbox);
const { buildEditorDocument, buildPreviewRequestBody, formatApiError } = sandbox.helpers;
const fixture = JSON.parse(fs.readFileSync('tests/.phase333-preview-a04ad4e9/storyboard.json', 'utf8'));
const toPlainJson = (value) => JSON.parse(JSON.stringify(value));

function fixtureFields(doc) {
  return {
    topic: doc.topic,
    duration: doc.duration,
    tone: doc.tone,
    audience: doc.audience,
    narrative_style: doc.narrative_style,
    title: doc.title,
    logline: doc.logline,
    opening_hook: doc.opening_hook,
    narration: doc.narration,
    ending: doc.ending,
  };
}

test('imported schema v2 metadata survives editor document construction', () => {
  const doc = toPlainJson(buildEditorDocument(fixture, fixtureFields(fixture), fixture.scenes));
  assert.equal(doc.schema_version, 2);
  assert.equal(doc.topic, 'Synthetic preview verification');
  assert.equal(doc.title, 'Preview Fixture');
  assert.equal(doc.tone, 'Neutral');
  assert.equal(doc.audience, 'Test');
  assert.equal(doc.narrative_style, 'Storyboard preview');
});

test('preview request body carries the current complete storyboard and does not downgrade schema version', () => {
  const doc = toPlainJson(buildEditorDocument(fixture, fixtureFields(fixture), fixture.scenes));
  const request = toPlainJson(buildPreviewRequestBody(doc));
  assert.equal(request.story.schema_version, 2);
  for (const field of ['tone', 'audience', 'narrative_style']) assert.equal(request.story[field], fixture[field]);
  assert.match(html, /body:JSON\.stringify\(buildPreviewRequestBody\(currentDoc\(\)\)\)/);
});

test('schema v1 remains compatible and is not silently relabeled by the editor', () => {
  const version1 = { ...fixture, schema_version: 1 };
  const doc = toPlainJson(buildEditorDocument(version1, fixtureFields(version1), version1.scenes));
  assert.equal(doc.schema_version, 1);
  assert.match(html, /schema_version:base\?\.schema_version\?\?1/);
});

test('structured backend errors display readable field paths and messages', () => {
  const message = formatApiError([
    { loc: ['body', 'story', 'tone'], msg: 'String should have at least 1 character' },
    { loc: ['body', 'story', 'scenes', 0, 'title'], msg: 'Field required' },
  ]);
  assert.equal(message, 'tone: String should have at least 1 character\nscenes[0].title: Field required');
  assert.match(html, /formatApiError\(err\.detail/);
  assert.match(html, /formatApiError\(data\.detail/);
});
