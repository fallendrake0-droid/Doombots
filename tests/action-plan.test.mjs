import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActionPlan } from '../src/agent/action_plan.js';

test('structured action plan accepts scalar arguments only after allowlist validation', () => {
    const plan = parseActionPlan('{"action":"bodyguard","args":["Steve"],"message":"On it."}', command => command === '!bodyguard');
    assert.equal(plan.recognized, true);
    assert.equal(plan.valid, true);
    assert.equal(plan.command, '!bodyguard("Steve")');
    assert.equal(plan.message, 'On it.');
});

test('structured action plan rejects malformed and unsafe plans', () => {
    assert.equal(parseActionPlan('{not json}').valid, false);
    assert.equal(parseActionPlan('{"action":"new-action!","args":[]}').valid, false);
    assert.equal(parseActionPlan('{"action":"goToPlayer","args":[{}]}').valid, false);
    assert.equal(parseActionPlan('{"action":"unknownAction","args":[]}', () => false).valid, false);
    assert.equal(parseActionPlan('{"action":"bodyguard","args":["Ste\\\"ve"]}', () => true).valid, false);
    assert.equal(parseActionPlan('{"action":"bodyguard","args":["Steve"],"message":"!stop"}', () => true).valid, false);
    assert.equal(parseActionPlan('!stop').recognized, false);
});
