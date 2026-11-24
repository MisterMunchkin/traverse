import {isDeepStrictEqual} from 'node:util';
import {need, object} from '../driving/contract.mjs';

// Tool-owned schemas currently use this closed subset. New keywords need validation
// here before a provider can be trusted to enforce them.
export function validateResponseSchema(schema) {
  need(object(schema) && ['object', 'array', 'string'].includes(schema.type), 'Unsupported response schema type');
  const keys = schema.type === 'object' ? ['type', 'properties', 'required', 'additionalProperties'] : schema.type === 'array' ? ['type', 'items'] : ['type', 'enum'];
  need(Object.keys(schema).every(key => keys.includes(key)), 'Unsupported response schema keyword');
  if (schema.type === 'object') {
    need(object(schema.properties) && Array.isArray(schema.required) && schema.additionalProperties === false, 'Response object schema must be closed');
    need(schema.required.every(key => typeof key === 'string' && Object.hasOwn(schema.properties, key)) && new Set(schema.required).size === schema.required.length, 'Invalid required schema fields');
    for (const child of Object.values(schema.properties)) validateResponseSchema(child);
  } else if (schema.type === 'array') validateResponseSchema(schema.items);
  else if (schema.enum !== undefined) need(Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every(value => typeof value === 'string'), 'Invalid schema enum');
}

export function validateStructuredOutput(value, schema) {
  if (schema.type === 'object') {
    need(object(value) && schema.required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => Object.hasOwn(schema.properties, key)), 'Structured response fields differ from schema');
    for (const [key, child] of Object.entries(value)) validateStructuredOutput(child, schema.properties[key]);
  } else if (schema.type === 'array') {
    need(Array.isArray(value), 'Structured response must be an array');
    for (const child of value) validateStructuredOutput(child, schema.items);
  } else need(typeof value === 'string' && (!schema.enum || schema.enum.includes(value)), 'Structured response string is not offered by schema');
}

export function claudeOutput(events, model, schema) {
  const inits = events.filter(e => e.type === 'system' && e.subtype === 'init');
  const finals = events.filter(e => e.type === 'result');
  const assistants = events.filter(e => e.type === 'assistant');
  need(inits.length === 1 && inits[0].model === model, 'Claude returned a different or unverified model; use an exact supported model ID');
  const init = inits[0];
  need(Array.isArray(init.tools) && init.tools.every(name => name === 'StructuredOutput') && Array.isArray(init.mcp_servers) && init.mcp_servers.length === 0, 'Claude enabled tools or MCP unexpectedly');
  need(assistants.every(e => e.message?.model === model && Array.isArray(e.message.content)), 'Claude assistant model is different or unverified');
  const calls = assistants.flatMap(e => e.message.content.filter(c => c.type === 'tool_use'));
  need(calls.length <= 1 && calls.every(c => c.name === 'StructuredOutput') && (!calls.length || init.tools.includes('StructuredOutput')), 'Claude attempted unexpected or repeated tool use');
  need(!events.some(e => e.type === 'control_request'), 'Claude attempted a control request');
  need(finals.length === 1 && !finals[0].is_error && finals[0].subtype === 'success', 'Claude did not complete a structured decision');
  const final = finals[0];
  validateStructuredOutput(final.structured_output, schema);
  if (calls.length) {
    validateStructuredOutput(calls[0].input, schema);
    need(isDeepStrictEqual(calls[0].input, final.structured_output), 'Claude structured output conflicts with its final response');
  }
  need(object(final.modelUsage) && Object.hasOwn(final.modelUsage, model), 'Claude usage reports a different or unknown model');
  const auxiliary = Object.keys(final.modelUsage).filter(name => name !== model);
  need(!auxiliary.length || assistants.length > 0, 'Claude multi-model usage lacks an observed decision model');
  return {init, final, auxiliary};
}
