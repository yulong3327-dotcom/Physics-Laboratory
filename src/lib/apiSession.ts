/** Ask the entry gate to recheck its cookie without discarding editor drafts. */
export function checkExpiredSession(response: Response) {
  if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('api-session-expired'))
}
