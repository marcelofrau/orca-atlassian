// `orca plugin check` renders the panel once per scenario, each with the worker on a fresh host
// (no network there, so these show the states before and after a token is saved).
import { defineCheck } from 'orca/testing'

export default defineCheck({
  fresh: {},
  configured: { settings: { baseUrl: 'https://wiki.example.com', spaces: 'DOC, OPS' } },
  withToken: { settings: { baseUrl: 'https://wiki.example.com' }, secrets: { token: 'example' } }
})
