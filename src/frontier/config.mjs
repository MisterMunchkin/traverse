// Keep metadata discovery and inference on the same first-party, tool-free CLI surface.
export function subscriptionEnvironment(env){
 const clean={...env};
 for(const key of Object.keys(clean))if(key.startsWith('OPENAI_')||key.startsWith('ANTHROPIC_')||key.startsWith('CLAUDE_CODE_USE_')||key==='CLAUDE_CODE_EFFORT_LEVEL'||['CODEX_API_KEY','AZURE_OPENAI_API_KEY'].includes(key))delete clean[key];
 return clean;
}
export const claudeRestrictedArgs=()=>['--print','--output-format','stream-json','--verbose','--safe-mode','--restricted','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--permission-mode','dontAsk','--permission-prompts','none','--no-session-persistence','--no-chrome','--setting-sources','','--settings','{"switchModelsOnFlag":false,"fallbackModel":[],"ultracode":false}'];
