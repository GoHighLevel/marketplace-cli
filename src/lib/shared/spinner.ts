import { sanitizeTerminalText } from '../api/response.js'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const CLEAR_LINE = '\r\u001B[2K'

/* Runs a task with a stderr spinner so stdout stays clean for data and
   piping. Quiet mode or a non-TTY stderr makes this a pure pass-through. */
export async function withSpinner<T>(
  text: string,
  task: () => Promise<T>,
  options?: { quiet?: boolean }
): Promise<T> {
  if (options?.quiet || !process.stderr.isTTY) return task()

  const safeText = sanitizeTerminalText(text, 200)
  let frame = 0
  const render = () => {
    process.stderr.write(`\r${FRAMES[frame]} ${safeText}`)
    frame = (frame + 1) % FRAMES.length
  }
  render()
  const timer = setInterval(render, 80)
  try {
    const result = await task()
    clearInterval(timer)
    process.stderr.write(CLEAR_LINE)
    return result
  } catch (error) {
    clearInterval(timer)
    process.stderr.write(`${CLEAR_LINE}✖ ${safeText}\n`)
    throw error
  }
}
