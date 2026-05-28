export enum ModelRole {
  Researcher = 'researcher', // bulk reading, summarizing search results, tool calls
  Synthesizer = 'synthesizer', // final report writing, judgment, structure
  Cheap = 'cheap', // utility calls (titles, classification, throwaway summaries)
}
