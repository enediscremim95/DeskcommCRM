import { describe, expect, it, vi } from "vitest";
import { canonicalPhoneBR, samePhone } from "@/lib/channels/phone-variants";
import { encontrarOuCriarContatoPorTelefone } from "@/lib/channels/contato-por-telefone";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("captação BR por identidade, para qualquer organização", () => {
  it.each(["(41) 99979-9652", "41999799652", "+5541999799652", "554199799652"])("normaliza %s", raw => {
    expect(canonicalPhoneBR(raw)).toBe("+5541999799652");
    expect(samePhone(raw, "+5541999799652")).toBe(true);
  });
  it.each(["org-a", "org-b"])("reaproveita e-mail antes de inserir em %s", async organizationId => {
    const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({data:{id:"existing",phone_number:null,name:"Teste"},error:null}), then: (resolve: (r: unknown)=>unknown) => Promise.resolve({data:[],error:null}).then(resolve) };
    const insert = vi.fn();
    const db = { from: vi.fn().mockReturnValue({...chain, insert}) } as unknown as SupabaseClient;
    expect((await encontrarOuCriarContatoPorTelefone(db,{organizationId,phone:"41999799652",email:"  TESTE@example.test  ",name:"Teste",source:"webhook"})).contato?.id).toBe("existing");
    expect(chain.eq).toHaveBeenCalledWith("organization_id",organizationId);
    expect(chain.eq).toHaveBeenCalledWith("email_normalized","teste@example.test");
    expect(insert).not.toHaveBeenCalled();
  });
});
