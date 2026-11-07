import { PACING_DEFAULTS } from "../../lib/agent-engine/pacing/defaults";
import {
  __nextDayOpenParaTeste,
  __nextWindowOpenParaTeste,
} from "../../lib/agent-engine/pacing/engine";

const AGORA = new Date("2026-11-03T12:00:00.000Z");
const JANELA_SEMPRE_FECHADA = {
  ...PACING_DEFAULTS,
  windowStartHour: 7,
  windowEndHour: 7,
  windowSaturdayEndHour: 7,
  allowSunday: false,
  timezone: "America/Sao_Paulo",
};

const helper = process.argv[2];
const abertura =
  helper === "nextWindowOpen"
    ? __nextWindowOpenParaTeste(AGORA, JANELA_SEMPRE_FECHADA)
    : __nextDayOpenParaTeste(AGORA, JANELA_SEMPRE_FECHADA);

process.stdout.write(abertura.toISOString());
