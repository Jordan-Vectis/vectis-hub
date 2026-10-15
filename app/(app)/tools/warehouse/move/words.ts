import { CONTAINER_STATUS, LOCATION_KINDS, type ContainerStatus } from "@/lib/goods-in/model"

// Small wording helpers shared by the Move, Bench and Find screens. Plain functions — safe in
// server and client components alike.

/** "bench", "storage", "shelf", "other" — the word staff see after a location code. */
export const kindWord = (k: string | null | undefined) => LOCATION_KINDS.find(x => x.value === k)?.label.toLowerCase() ?? "location"

/** A tote's status in words ("In storage"), for places where a coloured chip would need a key. */
export const statusWord = (s: string | null | undefined) => (s && s in CONTAINER_STATUS ? CONTAINER_STATUS[s as ContainerStatus].label : CONTAINER_STATUS.booked.label)

/** London clock time with seconds, for a list of scans made a few seconds apart. */
export const clock = (d: Date | string | number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(d))

/** "1 lot", "3 lots". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`
