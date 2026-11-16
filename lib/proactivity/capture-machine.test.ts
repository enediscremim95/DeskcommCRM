import { describe, expect, it, vi } from "vitest";
import { captureTick, type CaptureEffects, type CaptureProgress } from "./capture-machine";
import { captureBusinessHours, capturePolicy, capturePolicySchema } from "./capture-policy";
function effects() {
 const saves: CaptureProgress[] = [];
 const e: CaptureEffects = { whatsapp: vi.fn(async () => ({ result: "failed" as const })), email: vi.fn(async () => false), attention: vi.fn(async () => {}), save: vi.fn(async (v) => { saves.push(v); }), log: vi.fn(async () => {}) };
 return { e, saves };
}
describe("primeiro contato com envios simulados", () => {
 it("fica desligado em organizações novas e configuração inválida", () => {
  expect(capturePolicy({}).enabled).toBe(false);
  expect(capturePolicy({ capture_proactivity: { enabled: true } }).enabled).toBe(false);
 });
 it("segue WhatsApp, número corrigido, e-mail e atenção, sem loop", async () => {
  const { e, saves } = effects();
  let state: CaptureProgress = { step: "whatsapp" };
  for (let i=0;i<4;i++) { await captureTick(state,2,e); state=saves.at(-1)!; }
  expect(e.whatsapp).toHaveBeenNthCalledWith(1,false);
  expect(e.whatsapp).toHaveBeenNthCalledWith(2,true);
  expect(e.email).toHaveBeenCalledTimes(1);
  expect(e.attention).toHaveBeenCalledTimes(1);
  expect(state.step).toBe("done");
  await captureTick(state,2,e);
  expect(e.whatsapp).toHaveBeenCalledTimes(2);
 });
 it("termina após sucesso e não tenta e-mail", async () => {
  const { e,saves }=effects(); e.whatsapp=vi.fn(async () => ({ result: "sent" as const }));
  expect(await captureTick({ step:"whatsapp" },2,e)).toBe(true);
  expect(saves.at(-1)).toEqual({ step:"done" }); expect(e.email).not.toHaveBeenCalled();
 });
 it("mensagem na fila não dispara fallback", async () => {
  const { e,saves }=effects(); e.whatsapp=vi.fn(async () => ({ result:"pending" as const,messageId:"m" }));
  await captureTick({ step:"whatsapp" },2,e);
  expect(saves.at(-1)).toEqual({ step:"whatsapp",message_id:"m" }); expect(e.email).not.toHaveBeenCalled();
 });
 it("reserva e-mail antes do efeito e não repete após restart incerto", async () => {
  const { e,saves }=effects();
  e.email=vi.fn(async () => { expect(saves.at(-1)).toEqual({ step:"email",email_reserved:true }); return true; });
  await captureTick({ step:"email" },2,e);
  expect(saves.at(-1)).toEqual({ step:"done" });
  await captureTick({ step:"email",email_reserved:true },2,e);
  expect(e.email).toHaveBeenCalledTimes(1); expect(saves.at(-1)?.step).toBe("attention");
 });
 it("respeita o limite de uma tentativa de WhatsApp", async () => {
  const { e,saves }=effects(); await captureTick({ step:"whatsapp" },1,e);
  expect(saves.at(-1)?.step).toBe("email");
 });
 it("resultado incerto exige revisão, sem tentar outro canal", async () => {
  const { e,saves }=effects(); e.whatsapp=vi.fn(async () => ({ result:"uncertain" as const }));
  await captureTick({ step:"whatsapp" },2,e); expect(saves.at(-1)?.step).toBe("attention"); expect(e.email).not.toHaveBeenCalled();
 });
 it("calcula expediente no fuso e fecha o fim de semana", () => {
  const p=capturePolicySchema.parse({});
  expect(captureBusinessHours(p,new Date("2026-11-16T15:00:00Z"))).toBe(true);
  expect(captureBusinessHours(p,new Date("2026-11-16T22:00:00Z"))).toBe(false);
  expect(captureBusinessHours(p,new Date("2026-11-15T15:00:00Z"))).toBe(false);
 });
});
