import { countCharacters, countWords } from '../document-statistics'

interface StatisticsRequest {
  revision: number
  markdown: string
}

self.addEventListener('message', (event: MessageEvent<StatisticsRequest>) => {
  const { revision, markdown } = event.data
  self.postMessage({
    revision,
    wordCount: countWords(markdown),
    characterCount: countCharacters(markdown),
  })
})
