"use client"

import { io, type Socket } from "socket.io-client"

// One shared Socket.IO connection per tab.
//
// Several app-wide listeners want server pushes (the announcement banner, the
// force-refresh listener, and anything added later). Each calling io() itself
// meant one websocket PER LISTENER per tab — on ~20 shared iPads that's 40+
// connections for the same server, and a reconnect storm on every deploy.
// They're all the same socket; share it.
//
// Refcounted so the last listener to unmount closes it, and a listener
// unmounting never yanks the connection out from under the others.
let socket: Socket | null = null
let refs = 0

export function acquireAppSocket(): Socket {
  if (!socket) socket = io({ path: "/socket.io" })
  refs++
  return socket
}

export function releaseAppSocket(): void {
  refs = Math.max(0, refs - 1)
  if (refs === 0 && socket) {
    socket.disconnect()
    socket = null
  }
}
