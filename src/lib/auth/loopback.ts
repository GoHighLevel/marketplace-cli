import http from 'node:http'
import type { AddressInfo } from 'node:net'

export interface LoopbackServer {
  port: number
  /* Resolves with the one-time code once the browser redirects back. */
  waitForCode: Promise<string>
  close: () => void
}

const SUCCESS_HTML = `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding-top:80px">
<h2>Login successful</h2><p>You can close this tab and return to your terminal.</p></body></html>`

const ERROR_HTML = `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding-top:80px">
<h2>Login failed</h2><p>Return to your terminal for details.</p></body></html>`

export interface LoopbackCallbackResult {
  status: number
  html?: string
  code?: string
  error?: Error
}

export function handleLoopbackCallback(
  method: string | undefined,
  requestUrl: string | undefined,
  expectedState: string
): LoopbackCallbackResult {
  const url = new URL(requestUrl ?? '/', 'http://127.0.0.1')
  if (method !== 'GET' || url.pathname !== '/callback') return { status: 404 }

  const error = url.searchParams.get('error')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (error) {
    return { status: 200, html: ERROR_HTML, error: new Error(`Login was denied in the browser (${error})`) }
  }
  if (!code || state !== expectedState) {
    return {
      status: 400,
      html: ERROR_HTML,
      error: new Error('Callback state mismatch — possible code injection, aborting')
    }
  }
  return { status: 200, html: SUCCESS_HTML, code }
}

/* Binds to 127.0.0.1 only (never 0.0.0.0) so nothing off-machine can
   reach the callback. State mismatches are rejected to block code injection. */
export function startLoopbackServer(expectedState: string, timeoutMs = 300_000): Promise<LoopbackServer> {
  return new Promise((resolveServer, rejectServer) => {
    let resolveCode: (code: string) => void
    let rejectCode: (err: Error) => void
    const waitForCode = new Promise<string>((res, rej) => {
      resolveCode = res
      rejectCode = rej
    })

    const server = http.createServer((req, res) => {
      const result = handleLoopbackCallback(req.method, req.url, expectedState)
      const headers = result.html ? { 'content-type': 'text/html' } : undefined
      res.writeHead(result.status, headers).end(result.html)
      if (result.error) rejectCode(result.error)
      if (result.code) resolveCode(result.code)
    })

    const timer = setTimeout(() => {
      rejectCode(new Error('Timed out waiting for browser login (5 minutes)'))
      server.close()
    }, timeoutMs)

    server.once('error', error => {
      clearTimeout(timer)
      rejectServer(new Error(`Could not start the local login callback server: ${error.message}`))
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolveServer({
        port,
        waitForCode: waitForCode.finally(() => {
          clearTimeout(timer)
          server.close()
        }),
        close: () => {
          clearTimeout(timer)
          server.close()
        }
      })
    })
  })
}
