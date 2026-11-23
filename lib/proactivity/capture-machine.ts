/** Máquina durável: cada chamada executa no máximo uma tentativa. */
export type CaptureStep = "whatsapp" | "corrected" | "email" | "attention" | "done";
export interface CaptureProgress { step: CaptureStep; message_id?: string; email_reserved?: boolean }
export type AttemptResult = "sent" | "failed" | "pending" | "uncertain";
export interface CaptureEffects {
 whatsapp(corrected: boolean): Promise<{ result: AttemptResult; messageId?: string }>;
 email(): Promise<boolean>;
 attention(): Promise<void>;
 save(progress: CaptureProgress): Promise<void>;
 log(step: CaptureStep, result: string): Promise<void>;
}
export async function captureTick(state: CaptureProgress, maxWhatsappAttempts: number, effects: CaptureEffects): Promise<boolean> {
 if (state.step === "done") return true;
 if (state.step === "attention") {
  await effects.attention(); await effects.log("attention", "human_review"); await effects.save({ step: "done" }); return true;
 }
 if (state.step === "email") {
  // Reserva ANTES do efeito: em timeout/restart não repete um e-mail de resultado incerto.
  if (state.email_reserved) { await effects.save({ step: "attention" }); return false; }
  await effects.save({ step: "email", email_reserved: true });
  const sent = await effects.email(); await effects.log("email", sent ? "sent" : "failed");
  await effects.save({ step: sent ? "done" : "attention" }); return sent;
 }
 const result = await effects.whatsapp(state.step === "corrected");
 if (result.result !== "pending" || !state.message_id || state.message_id !== result.messageId) await effects.log(state.step, result.result);
 if (result.result === "pending") { await effects.save({ ...state, message_id: result.messageId }); return false; }
 if (result.result === "uncertain") { await effects.save({ step: "attention" }); return false; }
 if (result.result === "sent") { await effects.save({ step: "done" }); return true; }
 await effects.save({ step: state.step === "whatsapp" && maxWhatsappAttempts > 1 ? "corrected" : "email" }); return false;
}
