import { describe, expect, it } from "vitest";

import { buildTrafficDelivery, cleanDestinationUrl } from "./delivery";

describe("campanhas e páginas do relatório", () => {
  it("separa status ativo do fallback por investimento e ignora status inativo", () => {
    const delivery = buildTrafficDelivery([
      {
        account_id: "meta-1",
        platform: "meta_ads",
        campaign_id: "1",
        campaign_name: "Captação",
        campaign_status: "ACTIVE",
        destination_urls: ["https://cliente.test/oferta?utm_source=meta"],
        spend: 10,
      },
      {
        account_id: "google-1",
        platform: "google_ads",
        campaign_id: "2",
        campaign_name: "Pesquisa",
        campaign_status: null,
        destination_urls: ["https://cliente.test/oferta?gclid=abc#form"],
        spend: "20",
      },
      {
        account_id: "google-1",
        platform: "google_ads",
        campaign_id: "3",
        campaign_name: "Pausada",
        campaign_status: "PAUSED",
        destination_urls: ["https://cliente.test/pausada"],
        spend: 30,
      },
    ]);

    expect(delivery.active_campaigns).toEqual([{ name: "Captação", platform: "meta_ads" }]);
    expect(delivery.invested_campaigns).toEqual([{ name: "Pesquisa", platform: "google_ads" }]);
    expect(delivery.pages).toEqual(["cliente.test/oferta"]);
  });

  it("deduplica campanha e página e aceita URL sem protocolo", () => {
    const base = {
      account_id: "meta-1",
      platform: "meta_ads" as const,
      campaign_id: "1",
      campaign_name: "Captação",
      campaign_status: "ACTIVE",
      spend: 1,
    };
    const delivery = buildTrafficDelivery([
      { ...base, destination_urls: ["cliente.test/a/?utm_campaign=x"] },
      { ...base, destination_urls: ["https://CLIENTE.test/a#topo"] },
    ]);

    expect(delivery.active_campaigns).toHaveLength(1);
    expect(delivery.pages).toEqual(["cliente.test/a"]);
    expect(cleanDestinationUrl("javascript:alert(1)")).toBeNull();
  });

  it("usa o status mais recente do snapshot e restringe o fallback ao período", () => {
    const snapshot = [
      {
        account_id: "meta-1", platform: "meta_ads" as const, campaign_id: "1",
        campaign_name: "Captação", occurred_on: "2026-09-20", campaign_status: "PAUSED",
        destination_urls: ["https://cliente.test/antiga"], spend: 0,
      },
      {
        account_id: "meta-1", platform: "meta_ads" as const, campaign_id: "1",
        campaign_name: "Captação", occurred_on: "2026-09-19", campaign_status: "ACTIVE",
        destination_urls: ["https://cliente.test/antiga"], spend: 10,
      },
      {
        account_id: "google-1", platform: "google_ads" as const, campaign_id: "2",
        campaign_name: "Pesquisa", occurred_on: "2026-09-20", campaign_status: null,
        destination_urls: ["https://cliente.test/pesquisa"], spend: 50,
      },
    ];

    expect(buildTrafficDelivery([], snapshot)).toEqual({
      active_campaigns: [],
      invested_campaigns: [],
      pages: [],
    });
  });

  it("lista somente as páginas da data mais recente da campanha ativa", () => {
    const snapshot = [
      {
        account_id: "meta-1", platform: "meta_ads" as const, campaign_id: "1",
        campaign_name: "Captação", occurred_on: "2026-09-19", campaign_status: "ACTIVE",
        destination_urls: ["https://cliente.test/antiga"], spend: 10,
      },
      {
        account_id: "meta-1", platform: "meta_ads" as const, campaign_id: "1",
        campaign_name: "Captação", occurred_on: "2026-09-20", campaign_status: "ACTIVE",
        destination_urls: ["https://cliente.test/atual?utm_source=meta"], spend: 10,
      },
    ];

    expect(buildTrafficDelivery(snapshot, snapshot).pages).toEqual(["cliente.test/atual"]);
  });
});
