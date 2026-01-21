import { encode } from "@toon-format/toon";

export function toToon(data: unknown): string {
	return encode(data);
}
