import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

import { emBarraNormal } from "./helpers/caminho";
import { corpoDoHandlerExportado } from "./helpers/corpo-de-handler-http";
// A varredura devolve SEMPRE barra normal. Sem isto, no Windows ela devolvia
// `app\api\v1\...` e os dois `it` abaixo erravam em direções opostas: o
// `endsWith("/route.ts")` do primeiro casava ZERO arquivos (253 rotas passavam
// sem inspeção, e o gate ficava verde sem ter olhado nada), e o
// `p.split("/").at(-1)` do segundo devolvia o caminho inteiro, então as três
// exceções declaradas no `Set` de `exceptions` nunca casavam e os três arquivos
// justificados viravam acusação. No CI (Linux) passava, que é o que manteve o
// defeito vivo até aqui.
function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(join(dir,item.name)):[join(dir,item.name)]).map(emBarraNormal);}

// Controle positivo: sem ele, uma varredura quebrada devolve zero arquivos e
// zero é indistinguível de "está tudo em ordem" — foi assim que o separador de
// caminho passou despercebido. Mesma doutrina de `helpers/varrer-codigo.ts`.
it("a varredura enxerga os handlers e as actions que ela diz cobrir",()=>{
 expect(files("app/api/v1").filter(p=>p.endsWith("/route.ts")).length).toBeGreaterThan(100);
 expect(files("app/actions").filter(p=>!p.endsWith(".test.ts")).length).toBeGreaterThan(10);
});
it("todo handler mutante do app declara guarda de suporte ou é infraestrutura identificada",()=>{
 const uncovered:string[]=[];
 let inspecionados=0;
 let viuDeleteEnvolvido=false;
 for(const path of files("app/api/v1").filter(p=>p.endsWith("/route.ts"))){
  if(/app\/api\/v1\/(cron|webhooks)\//.test(path)||path==="app/api/v1/system/agent/route.ts")continue; // segredo de máquina, sem actor/session cookie
  if(path.includes("/impersonate"))continue; // início/fim autenticam a posse e têm contrato próprio
  const source=ts.createSourceFile(path,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true);
  // DUAS FORMAS de exportar um handler, e o gate precisa das duas. A varredura
  // só enxergava `export async function POST`; `export const PATCH = async () => {}`
  // é igualmente válida para o App Router e passava sem guarda NENHUMA, com o
  // gate verde. Wrappers do tipo `export const POST = comAuthDisponivel(POSTComAuth)`
  // (ou `comX(async () => …)`) também entram: o texto medido é o CORPO do
  // handler desembulhado, não a linha do wrapper. Estar envolvido por
  // comAuthDisponivel não substitui requireSupportWrite. Indireção opaca
  // (`export const POST = handle` importado de outro arquivo) cai como
  // descoberta de propósito: o gate não enxerga o corpo, e falhar fechado aqui
  // custa uma justificativa, enquanto falhar aberto custa uma rota sem guarda.
  const metodos=["POST","PUT","PATCH","DELETE"];
  for(const nome of metodos){
   const corpo=corpoDoHandlerExportado(source,nome);
   if(!corpo){
    // Só acusa se o arquivo realmente exporta esse método — senão toda rota
    // GET-only viraria descoberta falsa.
    const exporta=source.statements.some((node)=>{
     if(ts.isFunctionDeclaration(node)&&node.name?.text===nome)return true;
     if(!ts.isVariableStatement(node))return false;
     return node.declarationList.declarations.some((d)=>ts.isIdentifier(d.name)&&d.name.text===nome);
    });
    if(exporta)uncovered.push(`${path}:${nome}`);
    continue;
   }
   inspecionados += 1;
   if(path==="app/api/v1/contacts/[id]/route.ts"&&nome==="DELETE")viuDeleteEnvolvido=true;
   const texto=corpo.getText(source);
   if(!texto.includes("requireSupportWrite(")&&!texto.includes("methodNotAllowed("))uncovered.push(`${path}:${nome}`);
  }
 }
 // Controle positivo: se a desembulhadura quebrar, zero inspeções outra vez
 // passaria por "está tudo em ordem". O DELETE de contato é o caso envolvido
 // por comAuthDisponivel que este gate precisa continuar vendo.
 expect(inspecionados).toBeGreaterThan(50);
 expect(viuDeleteEnvolvido).toBe(true);
 expect(uncovered).toEqual([]);
});
it("Server Actions que resolvem tenant declaram efeito ou uma exceção pessoal/transição",()=>{
 const exceptions=new Set(["updateProfile.ts","trocarIdioma.ts","recoverOrganization.ts"]); // preferências próprias e recuperação sem org
 // `split(/[\\/]/)` e não `split("/")`: no Windows o `join` devolve `\`, o split
 // por `/` não separa nada, nenhuma exceção casa e o gate acusa os três arquivos
 // isentos. O vermelho só aparecia fora do CI, que é justamente onde quem escreve
 // roda a suíte antes de abrir PR.
 const uncovered=files("app/actions").filter(p=>!p.endsWith(".test.ts")&&!exceptions.has(p.split(/[\\/]/).at(-1)!)).filter(p=>{
  const text=readFileSync(p,"utf8");return /await resolveActiveOrg\(/.test(text)&&!text.includes("supportWriteError(");
 });expect(uncovered).toEqual([]);
});
