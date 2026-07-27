export function countWords(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?|```/g, ''))
    .replace(/!?(\[([^\]]*)\])\([^)]*\)/g, '$2')
    .replace(/<[^>]+>|[#>*_~`|\-[\]]/g, ' ')
  const chineseCharacters =
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0
  const otherWords =
    text
      .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)
      ?.filter((word) => !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word))
      .length ?? 0
  return chineseCharacters + otherWords
}

export function countCharacters(markdown: string): number {
  return Array.from(markdown).length
}
