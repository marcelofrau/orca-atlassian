// `orca plugin check` renders the panel once per scenario, each with the worker on a fresh host
// (no network there, so these show the states before and after the sites and tokens are set).
import { defineCheck } from 'orca/testing'

export default defineCheck({
  fresh: {},
  configured: { settings: { confluenceUrl: 'https://wiki.example.com', confluenceSpaces: 'DOC', jiraUrl: 'https://jira.example.com', jiraProjects: 'DOC' } },
  withTokens: {
    settings: { confluenceUrl: 'https://wiki.example.com', jiraUrl: 'https://jira.example.com' },
    secrets: { confluenceToken: 'example', jiraToken: 'example' }
  }
})
