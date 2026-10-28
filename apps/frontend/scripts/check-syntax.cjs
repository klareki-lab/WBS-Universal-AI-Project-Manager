const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');
let total=0;let errors=0;
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.tsx?$/.test(p)){total++;const r=ts.transpileModule(fs.readFileSync(p,'utf8'),{fileName:p,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});for(const d of r.diagnostics||[]){if(d.category===ts.DiagnosticCategory.Error){errors++;console.log(p,ts.flattenDiagnosticMessageText(d.messageText,'\n'));}}}}}
walk(path.join(__dirname,'../src'));console.log(`Syntax/transpile checks: ${total} files, ${errors} errors`);if(errors)process.exitCode=1;
