import { atom, map, computed, batched } from "nanostores"
import { persistentAtom } from "@nanostores/persistent"
import { createRouter } from "@nanostores/router"
import { action } from "@nanostores/logger"

export const $count = atom(0)
export const $user = map({ name: "", email: "", role: "guest" as string })
export const $theme = persistentAtom<"light" | "dark">("theme", "light")
export const $router = createRouter({ home: "/", about: "/about", settings: "/settings" })

export const $doubled = computed($count, (n) => n * 2)
export const $quadrupled = computed($doubled, (n) => n * 2)
export const $displayValue = computed([$quadrupled, $theme], (val, theme) => `${val} (${theme})`)
export const $batchedTotal = batched([$count, $doubled], (c, d) => c + d)

export const increment = action($count, "increment", ($store, amount: number = 1) => {
	$store.set($store.get() + amount)
})
export const updateUser = action($user, "updateUser", ($store, name: string, email: string) => {
	$store.set({ ...$store.get(), name, email })
})
