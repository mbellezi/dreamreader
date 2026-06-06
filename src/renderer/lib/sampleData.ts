import type { Annotation, AppSettings, BookDetails } from "@renderer/types"

export const defaultSettings: AppSettings = {
  locale: "pt-BR",
  appearance: "light",
  reader: {
    theme: "light",
    fontScale: 18,
    columnWidth: 720,
    lineHeight: 1.7,
    hyphenation: true
  }
}

export const sampleBooks: BookDetails[] = [
  {
    id: "sample-epub",
    title: "Cadernos de Aurora",
    authors: ["Lia Andrade"],
    language: "pt-BR",
    format: "epub",
    status: "reading",
    progress: 38,
    tags: ["ficcao", "notas", "brasil"],
    collection: "Leituras atuais",
    updatedAt: "2026-05-28T18:30:00.000Z",
    coverColor: "#315f72",
    publisher: "Arquivo local",
    description: "Um romance curto usado para validar navegação, progresso e marcações.",
    chapters: [
      {
        id: "aurora-1",
        title: "A sala azul",
        position: 1,
        text:
          "A cidade acordava antes do sol, quando as janelas ainda guardavam uma sombra fria e o café parecia uma promessa. Aurora caminhou pela sala azul sem acender as luzes, tocando a lombada dos livros como quem confere uma bússola.\n\nNa mesa, havia um bilhete dobrado em quatro partes. Não dizia muito, mas dizia o bastante: volte ao capítulo em que tudo começou. Ela sorriu, porque livros raramente obedecem ao tempo das pessoas.\n\nQuando abriu o volume antigo, encontrou uma marcação amarela junto a uma frase que não lembrava ter escolhido. A margem trazia sua letra, inclinada e apressada, perguntando se toda memória precisa de testemunha."
      },
      {
        id: "aurora-2",
        title: "O mapa incompleto",
        position: 2,
        text:
          "O sumário indicava doze capítulos, mas o exemplar tinha treze. O último não aparecia em nenhuma lista, e suas páginas estavam presas por uma fita verde. Aurora decidiu não puxá-la ainda.\n\nPreferiu anotar o que já sabia: nomes repetidos, lugares riscados, datas que fugiam da ordem. Em cada nota havia menos certeza e mais caminho.\n\nLer, pensou, talvez fosse isso: avançar com cuidado enquanto o texto aprende a confiar em você."
      },
      {
        id: "aurora-3",
        title: "Margens",
        position: 3,
        text:
          "À tarde, a chuva riscou o vidro com paciência. Aurora voltou à margem marcada e acrescentou uma estrela pequena, quase invisível. Era um lembrete para retornar sem pressa.\n\nEla sabia que nenhum livro termina exatamente onde acaba. Alguns seguem como uma voz baixa no corredor, reorganizando os móveis da memória.\n\nQuando fechou a capa, o progresso não parecia um número. Parecia uma conversa interrompida no ponto certo."
      }
    ]
  },
  {
    id: "sample-md",
    title: "Método de Leitura Atenta",
    authors: ["Nuno Pereira"],
    language: "pt-BR",
    format: "markdown",
    status: "unread",
    progress: 0,
    tags: ["estudo", "metodo"],
    collection: "Pesquisa",
    updatedAt: "2026-05-20T09:10:00.000Z",
    coverColor: "#7a4c2a",
    publisher: "Notas pessoais",
    description: "Guia prático para testar notas, favoritos e exportação em Markdown.",
    chapters: [
      {
        id: "metodo-1",
        title: "Preparar",
        position: 1,
        text:
          "Antes de começar, defina uma pergunta de leitura. Ela não precisa ser perfeita; precisa apenas orientar a atenção.\n\nSepare marcações para ideias centrais, dúvidas e trechos que merecem voltar. O objetivo não é colorir a página inteira, mas deixar rastros úteis.\n\nAo final de cada sessão, escreva uma nota breve com o que mudou na sua compreensão."
      },
      {
        id: "metodo-2",
        title: "Revisar",
        position: 2,
        text:
          "A revisão transforma leitura em repertório. Volte às notas no dia seguinte e procure ligações entre trechos distantes.\n\nExportar marcações ajuda quando o livro vira material de aula, ensaio ou pesquisa. Um bom arquivo de notas preserva contexto sem exigir que você releia tudo."
      }
    ]
  },
  {
    id: "sample-html",
    title: "Manual de Jardins Sonoros",
    authors: ["Helena Costa", "Raul Mendes"],
    language: "pt-BR",
    format: "html",
    status: "finished",
    progress: 100,
    tags: ["ensaio", "audio"],
    collection: "Referencias",
    updatedAt: "2026-05-12T12:45:00.000Z",
    coverColor: "#536b3d",
    publisher: "Acervo local",
    description: "Ensaio curto para validar lista, status e organização por coleção.",
    chapters: [
      {
        id: "jardins-1",
        title: "Escuta",
        position: 1,
        text:
          "Um jardim sonoro não começa no alto-falante. Começa no intervalo entre o que se espera ouvir e o que realmente aparece.\n\nCada planta muda o espaço. Cada passo muda a escuta. Por isso, anotar sons também é anotar movimento."
      }
    ]
  }
]

export const sampleAnnotations: Annotation[] = [
  {
    id: "annotation-1",
    bookId: "sample-epub",
    chapterId: "aurora-1",
    kind: "highlight",
    color: "yellow",
    excerpt: "livros raramente obedecem ao tempo das pessoas",
    note: "Boa frase para revisar depois.",
    createdAt: "2026-05-28T18:35:00.000Z"
  },
  {
    id: "annotation-2",
    bookId: "sample-epub",
    chapterId: "aurora-2",
    kind: "favorite",
    color: "green",
    excerpt: "avançar com cuidado enquanto o texto aprende a confiar em você",
    note: "",
    createdAt: "2026-05-29T08:10:00.000Z"
  }
]
