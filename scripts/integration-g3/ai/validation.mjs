// This source is also embedded verbatim in isolated n8n Code nodes.
export function validators() {
  const fail = () => { throw new Error('AI_SCHEMA_INVALID'); };
  const obj = (v, keys, required = keys) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)) || required.some(k => !(k in v))) fail();
  };
  const str = (v, max = 200, empty = false) => {
    if (typeof v !== 'string' || (!empty && !v.trim()) || v.length > max || /[\u0000\uD800-\uDFFF]/u.test(v)) fail();
  };
  const arr = (v, min, max) => { if (!Array.isArray(v) || v.length < min || v.length > max) fail(); };
  const strings = v => { arr(v, 0, 8); v.forEach(x => str(x, 400)); };
  const plan = p => {
    obj(p, ['summary', 'assumptions', 'risks', 'phases', 'tasks']);
    str(p.summary, 600); strings(p.assumptions); strings(p.risks);
    arr(p.phases, 2, 3); arr(p.tasks, 2, 5);
    const names = new Set(), ids = new Set();
    p.phases.forEach((x, i) => {
      obj(x, ['name', 'order', 'description'], ['name', 'order']); str(x.name);
      if (x.order !== i || names.has(x.name)) fail(); names.add(x.name);
      if (x.description !== undefined) str(x.description, 600, true);
    });
    p.tasks.forEach(t => {
      obj(t, ['tempId', 'phaseName', 'title', 'description', 'priority', 'dependsOn', 'estimateHours', 'definitionOfDone'], ['tempId', 'phaseName', 'title', 'priority', 'dependsOn', 'definitionOfDone']);
      str(t.tempId, 80); if (!/^[a-zA-Z0-9_-]+$/.test(t.tempId) || ids.has(t.tempId)) fail();
      str(t.title); str(t.definitionOfDone, 600); if (!names.has(t.phaseName) || !['low', 'medium', 'high', 'critical'].includes(t.priority)) fail();
      if (t.description !== undefined) str(t.description, 600, true);
      if (t.estimateHours !== undefined && (!Number.isFinite(t.estimateHours) || t.estimateHours < 0 || t.estimateHours > 100000)) fail();
      arr(t.dependsOn, 0, 5); if (new Set(t.dependsOn).size !== t.dependsOn.length || t.dependsOn.some(d => !ids.has(d))) fail();
      // Dependencies must refer to earlier tasks: no self reference or cycles.
      ids.add(t.tempId);
    }); return p;
  };
  const decision = (d, projectId) => {
    obj(d, ['intent', 'projectId', 'rationale', 'question']);
    if (d.intent !== 'plan' || d.projectId !== projectId || d.question !== null) fail(); str(d.rationale, 400); return d;
  };
  const review = r => {
    obj(r, ['ok', 'issues', 'revisedPlan']); if (typeof r.ok !== 'boolean') fail(); arr(r.issues, 0, 8);
    r.issues.forEach(i => { obj(i, ['severity', 'message']); if (!['info', 'warning', 'error'].includes(i.severity)) fail(); str(i.message, 400); });
    if (!r.ok || r.issues.some(i => i.severity === 'error') || r.revisedPlan !== null) fail(); return r;
  };
  const parse = v => {
    if (typeof v !== 'string' || v.length > 10000) fail();
    try { return JSON.parse(v); } catch { return fail(); }
  };
  return {plan, decision, review, parse};
}
