import {describe,expect,it} from 'vitest';
import {planningFailureMessage} from '../i18n/g4';
describe('planning failure explanations',()=>{
 it('distinguishes budget, delivery or validation, and exhausted retry attempts',()=>{
  expect(planningFailureMessage('AI_BUDGET_EXHAUSTED')).toContain('Budget');
  expect(planningFailureMessage('Automation delivery or result validation failed')).toContain('zugestellt oder ihr Ergebnis');
  expect(planningFailureMessage('Retry budget exhausted')).toContain('mehreren Versuchen');
 });
 it('does not invent a specific cause for an unknown failure',()=>{
  expect(planningFailureMessage('unknown')).toBe(planningFailureMessage(null));
 });
});
