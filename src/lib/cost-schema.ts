import { z } from "zod";
export const costValuesSchema = z
  .record(z.string().regex(/^[A-Z0-9]{1,30}$/), z.string().regex(/^\d{1,20}(\.\d{1,16})?$/))
  .refine((v) => Object.keys(v).length <= 500, "最多维护 500 种资产")
  .refine((v) => v.USDT === undefined || /^0*1(?:\.0+)?$/.test(v.USDT), "USDT 计价基准固定为 1");
export const costWriteSchema = z
  .object({
    revision: z.string().uuid().nullable(),
    costs: costValuesSchema,
  })
  .strict();
export type CostSettings = {
  revision: string | null;
  costs: Record<string, string>;
  updatedAt: number | null;
  updatedBy: string | null;
};
