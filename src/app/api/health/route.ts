import { json } from "@/lib/http";
import { name, version } from "../../../../package.json";
export async function GET() {
  return json({ ok: true, service: name, version });
}
