import { json } from "@/lib/http";
export async function GET() {
  return json({ ok: true, service: "slzb", version: "0.3.0" });
}
