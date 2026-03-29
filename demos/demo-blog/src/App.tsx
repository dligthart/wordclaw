import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useSearchParams,
  useParams,
} from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Archive,
  ArrowLeft,
  BookOpenText,
  Clock,
  LayoutDashboard,
  Loader2,
  Search,
  Shapes,
  Tag,
  Users,
} from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Author {
  id: number
  data: {
    name: string
    slug: string
    avatarUrl: string
    bio: string
    socialLinks: string[]
  }
  createdAt?: string
}

interface BlogPost {
  id: number
  data: {
    title: string
    slug: string
    excerpt: string
    content: string
    coverImage: string
    authorId: number
    category: string
    tags: string[]
    readTimeMinutes: number
  }
  createdAt: string
  updatedAt?: string
}

interface ContentTypeRecord {
  id: number
  slug: string
}

interface ContentItemRecord {
  id: number
  data: string | Record<string, unknown>
  status?: string
  createdAt: string
  updatedAt?: string
}

interface BlogSettingsData {
  siteTitle: string
  siteTagline: string
  homeEyebrow: string
  homeBody: string
  primaryCtaLabel: string
  primaryCtaHref: string
  secondaryCtaLabel: string
  secondaryCtaHref: string
}

interface ApiEnvelope<T> {
  data: T
  meta?: {
    nextCursor?: string | null
    hasMore?: boolean
  }
}

type DemoLoadResult = {
  posts: BlogPost[]
  authors: Author[]
  settings: BlogSettingsData | null
  loading: boolean
  error: string | null
  emptyReason: string | null
}

const API_BASE = (
  import.meta.env.VITE_WORDCLAW_URL || 'http://localhost:4000/api'
).replace(/\/$/, '')

const DemoDataContext = createContext<DemoLoadResult | null>(null)

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

const formatLongDate = (value: string) =>
  new Date(value).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

function sortPostsDescending(posts: BlogPost[]) {
  return [...posts].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
}

function buildEmptyStateMessage(reason: string) {
  return {
    title: 'The demo blog needs content',
    body: reason,
  }
}

function useWordClawDataSource(): DemoLoadResult {
  const [state, setState] = useState<DemoLoadResult>({
    posts: [],
    authors: [],
    settings: null,
    loading: true,
    error: null,
    emptyReason: null,
  })

  useEffect(() => {
    const loadData = async () => {
      try {
        const apiKey = import.meta.env.VITE_WORDCLAW_API_KEY || ''
        if (!apiKey) {
          throw new Error(
            'Missing VITE_WORDCLAW_API_KEY. Run `npm run demo:seed-blog` from the repo root or set demos/demo-blog/.env.',
          )
        }

        const headers = { 'x-api-key': apiKey }

        const fetchEnvelope = async <T,>(path: string): Promise<ApiEnvelope<T>> => {
          const res = await fetch(`${API_BASE}${path}`, { headers })
          const payload = await res.json().catch(() => ({}))

          if (!res.ok) {
            const errorMessage =
              typeof payload?.error === 'string'
                ? payload.error
                : `Request failed with ${res.status}`
            const remediation =
              typeof payload?.remediation === 'string'
                ? ` ${payload.remediation}`
                : ''
            throw new Error(`${errorMessage}.${remediation}`.trim())
          }

          return {
            data: (payload.data || []) as T,
            meta: payload.meta,
          }
        }

        const fetchContentItemCollection = async (
          contentTypeId: number,
          pageSize = 50,
        ): Promise<ContentItemRecord[]> => {
          const records: ContentItemRecord[] = []
          let cursor: string | null | undefined = undefined

          do {
            const query = new URLSearchParams({
              contentTypeId: String(contentTypeId),
              draft: 'false',
              limit: String(pageSize),
            })

            if (cursor) {
              query.set('cursor', cursor)
            }

            const payload = await fetchEnvelope<ContentItemRecord[]>(
              `/content-items?${query.toString()}`,
            )

            records.push(...payload.data)
            cursor = payload.meta?.nextCursor ?? null
          } while (cursor)

          return records
        }

        const parseItemData = <T,>(item: ContentItemRecord): T =>
        (typeof item.data === 'string'
          ? (JSON.parse(item.data) as T)
          : (item.data as T))

        const [typesResponse, settingsResponse] = await Promise.all([
          fetchEnvelope<ContentTypeRecord[]>(
            '/content-types?limit=500',
          ),
          (async () => {
            try {
              return await fetchEnvelope<{
                contentType: ContentTypeRecord
                item: ContentItemRecord | null
              }>('/globals/demo-blog-settings?draft=false')
            } catch {
              return null
            }
          })(),
        ])
        const types = typesResponse.data

        const authorType = types.find((entry) => entry.slug === 'demo-author')
        const postType = types.find((entry) => entry.slug === 'demo-blog-post')

        if (!authorType || !postType) {
          setState({
            posts: [],
            authors: [],
            settings: null,
            loading: false,
            error: null,
            emptyReason:
              'The blog schemas were not found for the current API key and domain. Run `npm run demo:seed-blog` from the repo root to seed the demo blog again.',
          })
          return
        }

        const [fetchedAuthors, fetchedPosts] = await Promise.all([
          fetchContentItemCollection(authorType.id),
          fetchContentItemCollection(postType.id),
        ])

        const settings = settingsResponse?.data?.item
          ? parseItemData<BlogSettingsData>(settingsResponse.data.item)
          : null

        const authors = fetchedAuthors.map(
          (item) =>
            ({
              ...item,
              data: parseItemData<Author['data']>(item),
            }) as Author,
        )

        const posts = sortPostsDescending(
          fetchedPosts.map(
            (item) =>
              ({
                ...item,
                data: parseItemData<BlogPost['data']>(item),
              }) as BlogPost,
          ),
        )

        setState({
          posts,
          authors,
          settings,
          loading: false,
          error: null,
          emptyReason:
            posts.length === 0
              ? 'The demo blog schemas exist, but this domain has no published demo-blog-post entries yet.'
              : null,
        })
      } catch (error) {
        setState({
          posts: [],
          authors: [],
          settings: null,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to load demo blog data from WordClaw.',
          emptyReason: null,
        })
      }
    }

    loadData()
  }, [])

  return state
}

function DemoDataProvider({ children }: { children: ReactNode }) {
  const state = useWordClawDataSource()
  return (
    <DemoDataContext.Provider value={state}>{children}</DemoDataContext.Provider>
  )
}

function useDemoData() {
  const value = useContext(DemoDataContext)
  if (!value) {
    throw new Error('useDemoData must be used within DemoDataProvider.')
  }
  return value
}

function getAuthor(authors: Author[], authorId: number) {
  return authors.find((author) => author.id === authorId)
}

function getCategoryEntries(posts: BlogPost[]) {
  const counts = new Map<string, number>()
  for (const post of posts) {
    counts.set(post.data.category, (counts.get(post.data.category) || 0) + 1)
  }

  return [...counts.entries()]
    .map(([name, count]) => ({
      name,
      slug: slugify(name),
      count,
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
}

function getTagEntries(posts: BlogPost[]) {
  const counts = new Map<string, number>()

  for (const post of posts) {
    for (const tag of post.data.tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({
      name,
      slug: slugify(name),
      count,
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
}

function parsePageParam(value: string | null) {
  const parsed = Number.parseInt(value || '1', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function clampPage(page: number, totalPages: number) {
  return Math.min(Math.max(page, 1), Math.max(totalPages, 1))
}

function paginateItems<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}

function getPageWindow(currentPage: number, totalPages: number) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, 5]
  }

  if (currentPage >= totalPages - 2) {
    return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }

  return [
    currentPage - 2,
    currentPage - 1,
    currentPage,
    currentPage + 1,
    currentPage + 2,
  ]
}

const markdownComponents: Components = {
  a: ({ href = '', children }) => {
    if (href.startsWith('/')) {
      return (
        <Link className="article-link" to={href}>
          {children}
        </Link>
      )
    }

    return (
      <a className="article-link" href={href} rel="noreferrer" target="_blank">
        {children}
      </a>
    )
  },
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className || '')
    const content = String(children ?? '').replace(/\n$/, '')

    if (match) {
      return (
        <SyntaxHighlighter
          customStyle={{
            margin: '1.75rem 0',
            padding: '1rem 1.25rem',
            borderRadius: '1rem',
            background: '#10131f',
            border: '1px solid rgba(122, 143, 182, 0.16)',
          }}
          language={match[1]}
          style={atomDark}
        >
          {content}
        </SyntaxHighlighter>
      )
    }

    return <code>{children}</code>
  },
}

function LoadingState() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-brand-500" />
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="w-full max-w-4xl px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-500">
          Demo setup
        </p>
        <h2 className="mt-4 text-3xl font-bold tracking-tight text-[var(--foreground)]">
          {title}
        </h2>
        <p className="mt-4 text-base leading-7 text-[var(--muted-foreground)]">
          {body}
        </p>
        <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[#10131f] p-5">
          <p className="text-sm font-medium text-gray-200">Recommended local setup</p>
          <pre className="mt-4 overflow-x-auto text-sm leading-6 text-gray-300">{`npm run demo:seed-blog
cd demos/demo-blog && npm run dev`}</pre>
        </div>
      </div>
    </div>
  )
}

function DemoStateBoundary({ children }: { children: ReactNode }) {
  const { loading, error, emptyReason } = useDemoData()

  if (loading) {
    return <LoadingState />
  }

  if (error) {
    return <EmptyState body={error} title="The demo blog could not load content" />
  }

  if (emptyReason) {
    const message = buildEmptyStateMessage(emptyReason)
    return <EmptyState body={message.body} title={message.title} />
  }

  return <>{children}</>
}

function SectionHeading({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string
  title: string
  copy?: string
}) {
  return (
    <div className="mb-8">
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight text-[var(--foreground)]">
        {title}
      </h2>
      {copy ? (
        <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted-foreground)]">
          {copy}
        </p>
      ) : null}
    </div>
  )
}

function PageShell({
  children,
  className = '',
  size = 'default',
}: {
  children: ReactNode
  className?: string
  size?: 'default' | 'narrow' | 'wide'
}) {
  const maxWidthClass =
    size === 'narrow'
      ? 'max-w-6xl'
      : size === 'wide'
        ? 'max-w-[86rem]'
        : 'max-w-7xl'

  return (
    <div className={`mx-auto w-full ${maxWidthClass} px-4 py-10 sm:px-6 sm:py-14 lg:px-8 ${className}`}>
      {children}
    </div>
  )
}

function Pagination({
  currentPage,
  totalPages,
  buildHref,
}: {
  currentPage: number
  totalPages: number
  buildHref: (page: number) => string
}) {
  if (totalPages <= 1) {
    return null
  }

  const pageWindow = getPageWindow(currentPage, totalPages)

  return (
    <nav
      aria-label="Pagination"
      className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-5"
    >
      <div className="text-sm text-[var(--muted-foreground)]">
        Page {currentPage} of {totalPages}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          aria-disabled={currentPage === 1}
          className={`inline-flex h-10 items-center justify-center rounded-full border px-4 text-sm font-medium transition-colors ${currentPage === 1
            ? 'cursor-not-allowed border-[var(--border)] text-[var(--muted-foreground)]/60'
            : 'border-[var(--border)] text-[var(--foreground)] hover:border-brand-300 hover:text-brand-600'
            }`}
          to={currentPage === 1 ? '#' : buildHref(currentPage - 1)}
        >
          Previous
        </Link>

        {pageWindow.map((page) => (
          <Link
            className={`inline-flex h-10 min-w-10 items-center justify-center rounded-full border px-3 text-sm font-semibold transition-colors ${page === currentPage
              ? 'border-brand-500 bg-brand-500 text-white'
              : 'border-[var(--border)] text-[var(--foreground)] hover:border-brand-300 hover:text-brand-600'
              }`}
            key={page}
            to={buildHref(page)}
          >
            {page}
          </Link>
        ))}

        <Link
          aria-disabled={currentPage === totalPages}
          className={`inline-flex h-10 items-center justify-center rounded-full border px-4 text-sm font-medium transition-colors ${currentPage === totalPages
            ? 'cursor-not-allowed border-[var(--border)] text-[var(--muted-foreground)]/60'
            : 'border-[var(--border)] text-[var(--foreground)] hover:border-brand-300 hover:text-brand-600'
            }`}
          to={currentPage === totalPages ? '#' : buildHref(currentPage + 1)}
        >
          Next
        </Link>
      </div>
    </nav>
  )
}

function PostCard({ post, author }: { post: BlogPost; author?: Author }) {
  return (
    <Link to={`/post/${post.data.slug}`}>
      <motion.article
        className="demo-surface group relative flex h-full flex-col rounded-3xl p-5 transition-all duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-xl hover:shadow-brand-500/5"
        initial={{ opacity: 0, y: 18 }}
        viewport={{ once: true }}
        whileInView={{ opacity: 1, y: 0 }}
      >
        <div className="relative mb-5 aspect-[16/10] overflow-hidden rounded-2xl bg-brand-100/40">
          <img
            alt={post.data.title}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            src={post.data.coverImage || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2864&auto=format&fit=crop'}
            onError={(e) => { e.currentTarget.src = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2864&auto=format&fit=crop' }}
          />
          <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm backdrop-blur-sm">
            {post.data.category}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
          <span className="inline-flex items-center gap-1">
            <Clock size={13} />
            {formatDate(post.createdAt)}
          </span>
          <span>{post.data.readTimeMinutes} min read</span>
        </div>

        <h3 className="mt-4 text-2xl font-semibold leading-tight text-[var(--foreground)] transition-colors group-hover:text-brand-500">
          {post.data.title}
        </h3>
        <p className="mt-3 flex-1 text-sm leading-7 text-[var(--muted-foreground)]">
          {post.data.excerpt}
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {post.data.tags.slice(0, 3).map((tag) => (
            <span
              className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
              key={tag}
            >
              #{tag}
            </span>
          ))}
        </div>

        {author ? (
          <div className="mt-6 flex items-center gap-3 border-t border-[var(--border)] pt-5">
            <img
              alt={author.data.name}
              className="h-11 w-11 rounded-full object-cover"
              src={author.data.avatarUrl}
            />
            <div>
              <p className="font-medium text-[var(--foreground)]">{author.data.name}</p>
              <p className="text-sm text-[var(--muted-foreground)]">{author.data.bio}</p>
            </div>
          </div>
        ) : null}
      </motion.article>
    </Link>
  )
}

function MarkdownArticle({ content }: { content: string }) {
  return (
    <div className="article-body">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

function HomePage() {
  const { posts, authors, settings } = useDemoData()
  const [visiblePostCount, setVisiblePostCount] = useState(4)
  const featuredPost = posts[0]
  const additionalPosts = posts.slice(1)
  const recentPosts = additionalPosts.slice(0, visiblePostCount)
  const categories = getCategoryEntries(posts)

  if (!featuredPost) {
    return <EmptyState body="No featured post is available yet." title="The demo blog has no featured article" />
  }

  const featuredAuthor = getAuthor(authors, featuredPost.data.authorId)

  return (
    <PageShell>
      <section className="grid gap-8 xl:grid-cols-[1.08fr_0.92fr] xl:items-stretch">
        <div className="demo-surface rounded-[2rem] p-8 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">
            {settings?.homeEyebrow || 'Featured article'}
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--muted-foreground)]">
            {settings?.homeBody || 'This frontend reads published content snapshots from WordClaw and renders them into a schema-backed editorial surface.'}
          </p>
          <h1 className="mt-5 max-w-3xl text-4xl font-bold tracking-tight text-[var(--foreground)] sm:text-5xl">
            {featuredPost.data.title}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted-foreground)]">
            {featuredPost.data.excerpt}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4 text-sm text-[var(--muted-foreground)]">
            <span>{formatLongDate(featuredPost.createdAt)}</span>
            <span>{featuredPost.data.readTimeMinutes} min read</span>
            <Link className="font-medium text-brand-500" to={`/category/${slugify(featuredPost.data.category)}`}>
              {featuredPost.data.category}
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              className="inline-flex h-11 items-center justify-center rounded-full bg-brand-500 px-5 text-sm font-semibold text-white shadow-[0_12px_24px_-16px_rgba(59,96,204,0.8)] transition-colors hover:bg-brand-600"
              to={settings?.primaryCtaHref || `/post/${featuredPost.data.slug}`}
            >
              {settings?.primaryCtaLabel || 'Read article'}
            </Link>
            <Link
              className="inline-flex h-11 items-center justify-center rounded-full border border-[var(--border)] bg-white/80 px-5 text-sm font-semibold text-[var(--foreground)] transition-colors hover:border-brand-300 hover:text-brand-500"
              to={settings?.secondaryCtaHref || '/archive'}
            >
              {settings?.secondaryCtaLabel || 'Browse archive'}
            </Link>
          </div>
        </div>

        <div className="demo-surface overflow-hidden rounded-[2rem] p-0">
          <img
            alt={featuredPost.data.title}
            className="h-full min-h-[20rem] w-full object-cover"
            src={featuredPost.data.coverImage || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2864&auto=format&fit=crop'}
            onError={(e) => { e.currentTarget.src = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2864&auto=format&fit=crop' }}
          />
        </div>
      </section>

      <section className="mt-16 grid gap-5 md:grid-cols-3">
        <div className="demo-surface rounded-3xl p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">
            Editorial demo
          </p>
          <p className="mt-4 text-4xl font-bold text-[var(--foreground)]">{posts.length}</p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">Published demo posts with rich markdown content.</p>
        </div>
        <div className="demo-surface rounded-3xl p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">
            Authors
          </p>
          <p className="mt-4 text-4xl font-bold text-[var(--foreground)]">{authors.length}</p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">Editorial personas with linked author pages and bios.</p>
        </div>
        <div className="demo-surface rounded-3xl p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">
            Categories
          </p>
          <p className="mt-4 text-4xl font-bold text-[var(--foreground)]">{categories.length}</p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">Category browsing, archive pages, and related post groupings.</p>
        </div>
      </section>

      <section className="mt-16">
        <SectionHeading
          copy="Recent seeded entries with connected authors and markdown-driven editorial bodies."
          eyebrow="Latest posts"
          title="Recently published"
        />
        <div className="grid gap-6 lg:grid-cols-2">
          {recentPosts.map((post) => (
            <PostCard author={getAuthor(authors, post.data.authorId)} key={post.id} post={post} />
          ))}
        </div>
        {visiblePostCount < additionalPosts.length ? (
          <div className="mt-8 flex justify-center">
            <button
              className="inline-flex items-center justify-center rounded-full border border-[var(--border)] bg-white/80 px-5 py-3 text-sm font-semibold text-[var(--foreground)] transition-colors hover:border-brand-300 hover:text-brand-500"
              onClick={() =>
                startTransition(() => {
                  setVisiblePostCount((current) =>
                    Math.min(current + 4, additionalPosts.length),
                  )
                })
              }
              type="button"
            >
              More stories
            </button>
          </div>
        ) : (
          <div className="mt-8 flex justify-center">
            <Link
              className="inline-flex items-center justify-center rounded-full border border-[var(--border)] bg-white/80 px-5 py-3 text-sm font-semibold text-[var(--foreground)] transition-colors hover:border-brand-300 hover:text-brand-500"
              to="/archive"
            >
              Browse full archive
            </Link>
          </div>
        )}
      </section>

      <section className="mt-16 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="demo-surface rounded-[2rem] p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">
            Byline
          </p>
          {featuredAuthor ? (
            <div className="mt-5">
              <div className="flex items-center gap-4">
                <img
                  alt={featuredAuthor.data.name}
                  className="h-16 w-16 rounded-full object-cover"
                  src={featuredAuthor.data.avatarUrl}
                />
                <div>
                  <h3 className="text-xl font-semibold text-[var(--foreground)]">{featuredAuthor.data.name}</h3>
                  <p className="text-sm text-[var(--muted-foreground)]">{featuredAuthor.data.bio}</p>
                </div>
              </div>
              <Link
                className="mt-6 inline-flex text-sm font-semibold text-brand-500"
                to={`/author/${featuredAuthor.data.slug}`}
              >
                View author page
              </Link>
            </div>
          ) : null}
        </div>

        <div className="demo-surface rounded-[2rem] p-8">
          <SectionHeading
            copy="Jump into the seeded category views to inspect different content clusters."
            eyebrow="Explore"
            title="Browse by category"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {categories.map((category) => (
              <Link
                className="rounded-2xl border border-[var(--border)] bg-[var(--background)]/70 px-5 py-4 transition-colors hover:border-brand-300 hover:bg-white hover:text-brand-500"
                key={category.slug}
                to={`/category/${category.slug}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-[var(--foreground)]">{category.name}</span>
                  <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
                    {category.count}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </PageShell>
  )
}

function AuthorsPage() {
  const { authors, posts } = useDemoData()

  return (
    <PageShell>
      <SectionHeading
        copy="Browse the seeded editorial voices behind the demo blog."
        eyebrow="Authors"
        title="Meet the editorial team"
      />
      <div className="grid gap-8 lg:grid-cols-3">
        {authors.map((author) => {
          const authoredPosts = posts.filter((post) => post.data.authorId === author.id)
          return (
            <Link
              className="demo-surface rounded-[2rem] p-7 transition-all hover:-translate-y-1 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-500/5"
              key={author.id}
              to={`/author/${author.data.slug}`}
            >
              <img
                alt={author.data.name}
                className="h-16 w-16 rounded-full object-cover"
                src={author.data.avatarUrl}
              />
              <h3 className="mt-5 text-2xl font-semibold text-[var(--foreground)]">{author.data.name}</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">{author.data.bio}</p>
              <p className="mt-6 text-sm font-medium text-brand-500">{authoredPosts.length} published articles</p>
            </Link>
          )
        })}
      </div>
    </PageShell>
  )
}

function AuthorDetailPage() {
  const { slug } = useParams()
  const [searchParams] = useSearchParams()
  const { authors, posts } = useDemoData()
  const author = authors.find((entry) => entry.data.slug === slug)

  if (!author) {
    return <EmptyState body="The requested author was not found in the seeded demo data." title="Author not found" />
  }

  const authoredPosts = posts.filter((post) => post.data.authorId === author.id)
  const totalPages = Math.max(1, Math.ceil(authoredPosts.length / 4))
  const currentPage = clampPage(parsePageParam(searchParams.get('page')), totalPages)
  const pagedPosts = paginateItems(authoredPosts, currentPage, 4)

  return (
    <PageShell>
      <Link className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-brand-500" to="/authors">
        <ArrowLeft size={16} />
        Back to authors
      </Link>

      <div className="demo-surface mt-8 rounded-[2rem] p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <img
            alt={author.data.name}
            className="h-24 w-24 rounded-full object-cover"
            src={author.data.avatarUrl}
          />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">
              Author profile
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-[var(--foreground)]">
              {author.data.name}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-[var(--muted-foreground)]">
              {author.data.bio}
            </p>
          </div>
        </div>
      </div>

      <section className="mt-16">
        <SectionHeading
          eyebrow="Articles"
          title={`${authoredPosts.length} published posts`}
        />
        <div className="grid gap-8 lg:grid-cols-2">
          {pagedPosts.map((post) => (
            <PostCard author={author} key={post.id} post={post} />
          ))}
        </div>
        <Pagination
          buildHref={(page) => `/author/${author.data.slug}?page=${page}`}
          currentPage={currentPage}
          totalPages={totalPages}
        />
      </section>
    </PageShell>
  )
}

function CategoriesPage() {
  const { posts } = useDemoData()
  const categories = getCategoryEntries(posts)

  return (
    <PageShell>
      <SectionHeading
        copy="The demo blog includes several content clusters so you can see how category-led browsing feels in a schema-backed frontend."
        eyebrow="Categories"
        title="Browse the archive by category"
      />
      <div className="grid gap-6 lg:grid-cols-3">
        {categories.map((category) => (
          <Link
            className="demo-surface rounded-[2rem] p-7 transition-all hover:-translate-y-1 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-500/5"
            key={category.slug}
            to={`/category/${category.slug}`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">
              Category
            </p>
            <h3 className="mt-4 text-2xl font-semibold text-[var(--foreground)]">{category.name}</h3>
            <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">
              {category.count} seeded articles connected to this editorial topic.
            </p>
          </Link>
        ))}
      </div>
    </PageShell>
  )
}

function TagsPage() {
  const { posts } = useDemoData()
  const tags = getTagEntries(posts)

  return (
    <PageShell>
      <SectionHeading
        copy="Browse the seeded post taxonomy by tag to see related content cluster naturally across categories."
        eyebrow="Tags"
        title="Explore by topic"
      />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {tags.map((tag) => (
          <Link
            className="demo-surface rounded-[2rem] p-7 transition-all hover:-translate-y-1 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-500/5"
            key={tag.slug}
            to={`/tag/${tag.slug}`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">
              Topic
            </p>
            <h3 className="mt-4 text-2xl font-semibold text-[var(--foreground)]">
              #{tag.name}
            </h3>
            <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">
              {tag.count} post{tag.count === 1 ? '' : 's'} tagged with this topic.
            </p>
          </Link>
        ))}
      </div>
    </PageShell>
  )
}

function CategoryDetailPage() {
  const { categorySlug } = useParams()
  const [searchParams] = useSearchParams()
  const { posts, authors } = useDemoData()
  const category = getCategoryEntries(posts).find((entry) => entry.slug === categorySlug)

  if (!category) {
    return <EmptyState body="The requested category was not found in the seeded demo data." title="Category not found" />
  }

  const categoryPosts = posts.filter((post) => slugify(post.data.category) === category.slug)
  const totalPages = Math.max(1, Math.ceil(categoryPosts.length / 4))
  const currentPage = clampPage(parsePageParam(searchParams.get('page')), totalPages)
  const pagedPosts = paginateItems(categoryPosts, currentPage, 4)

  return (
    <PageShell>
      <Link className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-brand-500" to="/categories">
        <ArrowLeft size={16} />
        Back to categories
      </Link>

      <div className="demo-surface mt-8 rounded-[2rem] p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">
          Category
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-[var(--foreground)]">
          {category.name}
        </h1>
        <p className="mt-4 text-base leading-8 text-[var(--muted-foreground)]">
          {category.count} demo post{category.count === 1 ? '' : 's'} in this archive slice.
        </p>
      </div>

      <div className="mt-16 grid gap-8 lg:grid-cols-2">
        {pagedPosts.map((post) => (
          <PostCard author={getAuthor(authors, post.data.authorId)} key={post.id} post={post} />
        ))}
      </div>
      <Pagination
        buildHref={(page) => `/category/${category.slug}?page=${page}`}
        currentPage={currentPage}
        totalPages={totalPages}
      />
    </PageShell>
  )
}

function TagDetailPage() {
  const { tagSlug } = useParams()
  const [searchParams] = useSearchParams()
  const { posts, authors } = useDemoData()
  const tag = getTagEntries(posts).find((entry) => entry.slug === tagSlug)

  if (!tag) {
    return (
      <EmptyState
        body="The requested tag was not found in the seeded demo data."
        title="Tag not found"
      />
    )
  }

  const taggedPosts = posts.filter((post) =>
    post.data.tags.some((entry) => slugify(entry) === tag.slug),
  )
  const totalPages = Math.max(1, Math.ceil(taggedPosts.length / 4))
  const currentPage = clampPage(parsePageParam(searchParams.get('page')), totalPages)
  const pagedPosts = paginateItems(taggedPosts, currentPage, 4)

  return (
    <PageShell>
      <Link
        className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-brand-500"
        to="/tags"
      >
        <ArrowLeft size={16} />
        Back to tags
      </Link>

      <div className="demo-surface mt-8 rounded-[2rem] p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">
          Topic
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-[var(--foreground)]">
          #{tag.name}
        </h1>
        <p className="mt-4 text-base leading-8 text-[var(--muted-foreground)]">
          {tag.count} demo post{tag.count === 1 ? '' : 's'} carrying this shared topic.
        </p>
      </div>

      <div className="mt-16 grid gap-8 lg:grid-cols-2">
        {pagedPosts.map((post) => (
          <PostCard author={getAuthor(authors, post.data.authorId)} key={post.id} post={post} />
        ))}
      </div>
      <Pagination
        buildHref={(page) => `/tag/${tag.slug}?page=${page}`}
        currentPage={currentPage}
        totalPages={totalPages}
      />
    </PageShell>
  )
}

function ArchivePage() {
  const [searchParams] = useSearchParams()
  const { posts, authors } = useDemoData()
  const totalPages = Math.max(1, Math.ceil(posts.length / 5))
  const currentPage = clampPage(parsePageParam(searchParams.get('page')), totalPages)
  const pagedPosts = paginateItems(posts, currentPage, 5)

  return (
    <PageShell>
      <SectionHeading
        copy="A denser chronological archive for quickly scanning every seeded article."
        eyebrow="Archive"
        title="All posts"
      />
      <div className="demo-surface overflow-hidden rounded-[2rem] p-0">
        <div className="overflow-x-auto">
          <div className="min-w-[52rem]">
            <div className="grid grid-cols-[minmax(0,1.4fr)_0.9fr_0.8fr_0.8fr] gap-4 border-b border-[var(--border)] px-6 py-4 text-xs font-semibold uppercase tracking-[0.35em] text-[var(--muted-foreground)]">
              <span>Title</span>
              <span>Author</span>
              <span>Category</span>
              <span>Published</span>
            </div>
            {pagedPosts.map((post) => {
              const author = getAuthor(authors, post.data.authorId)
              return (
                <Link
                  className="grid grid-cols-[minmax(0,1.4fr)_0.9fr_0.8fr_0.8fr] gap-4 border-b border-[var(--border)] px-6 py-5 transition-colors hover:bg-brand-50/60"
                  key={post.id}
                  to={`/post/${post.data.slug}`}
                >
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">{post.data.title}</p>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">{post.data.excerpt}</p>
                  </div>
                  <span className="text-sm text-[var(--muted-foreground)]">
                    {author?.data.name || 'Unknown author'}
                  </span>
                  <span className="text-sm text-[var(--muted-foreground)]">{post.data.category}</span>
                  <span className="text-sm text-[var(--muted-foreground)]">{formatDate(post.createdAt)}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
      <Pagination
        buildHref={(page) => `/archive?page=${page}`}
        currentPage={currentPage}
        totalPages={totalPages}
      />
    </PageShell>
  )
}

function PostDetailPage() {
  const { slug } = useParams()
  const { posts, authors } = useDemoData()
  const post = posts.find((entry) => entry.data.slug === slug)

  if (!post) {
    return <EmptyState body="The requested post was not found in the seeded demo data." title="Post not found" />
  }

  const author = getAuthor(authors, post.data.authorId)
  const relatedPosts = posts
    .filter((entry) => entry.id !== post.id && entry.data.category === post.data.category)
    .slice(0, 3)

  return (
    <motion.article animate={{ opacity: 1 }} className="w-full" initial={{ opacity: 0 }}>
      <PageShell>
        <Link className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-brand-500" to="/">
          <ArrowLeft size={16} />
          Back to blog
        </Link>

        <header className="mt-10">
          <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted-foreground)]">
            <Link
              className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700"
              to={`/category/${slugify(post.data.category)}`}
            >
              {post.data.category}
            </Link>
            <span>{formatLongDate(post.createdAt)}</span>
            <span>{post.data.readTimeMinutes} min read</span>
          </div>

          <h1 className="mt-6 max-w-4xl text-4xl font-bold tracking-tight text-[var(--foreground)] sm:text-5xl lg:text-6xl">
            {post.data.title}
          </h1>
          <p className="mt-6 max-w-3xl text-xl leading-8 text-[var(--muted-foreground)]">
            {post.data.excerpt}
          </p>

          {author ? (
            <div className="demo-surface mt-10 inline-flex items-center gap-4 rounded-full px-5 py-3 pr-8">
              <img
                alt={author.data.name}
                className="h-12 w-12 rounded-full object-cover"
                src={author.data.avatarUrl}
              />
              <div>
                <Link className="font-semibold text-[var(--foreground)] hover:text-brand-500" to={`/author/${author.data.slug}`}>
                  {author.data.name}
                </Link>
                <p className="text-xs text-[var(--muted-foreground)] line-clamp-1 max-w-[18rem]">{author.data.bio}</p>
              </div>
            </div>
          ) : null}
        </header>

        <div className="demo-surface mt-12 overflow-hidden rounded-[2rem] p-0">
          <img
            alt={post.data.title}
            className="h-full max-h-[30rem] w-full object-cover"
            src={post.data.coverImage || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2864&auto=format&fit=crop'}
            onError={(e) => { e.currentTarget.src = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2864&auto=format&fit=crop' }}
          />
        </div>

        <div className="mt-14 grid gap-10 xl:grid-cols-[minmax(0,46rem)_18rem] xl:justify-between">
          <div className="min-w-0">
            <MarkdownArticle content={post.data.content} />
          </div>

          <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
            <div className="demo-surface rounded-3xl p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">
                Tags
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {post.data.tags.map((tag) => (
                  <Link
                    className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700"
                    key={tag}
                    to={`/tag/${slugify(tag)}`}
                  >
                    #{tag}
                  </Link>
                ))}
              </div>
            </div>
            <div className="demo-surface rounded-3xl p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">
                Explore
              </p>
              <div className="mt-4 space-y-3">
                <Link className="block font-medium text-[var(--foreground)] hover:text-brand-500" to="/archive">
                  Browse archive
                </Link>
                <Link className="block font-medium text-[var(--foreground)] hover:text-brand-500" to="/authors">
                  View authors
                </Link>
                <Link className="block font-medium text-[var(--foreground)] hover:text-brand-500" to="/categories">
                  Browse categories
                </Link>
                <Link className="block font-medium text-[var(--foreground)] hover:text-brand-500" to="/tags">
                  Browse tags
                </Link>
              </div>
            </div>
          </aside>
        </div>

        {relatedPosts.length > 0 ? (
          <section className="mt-20">
            <SectionHeading
              eyebrow="More in this category"
              title={`Related ${post.data.category} articles`}
            />
            <div className="grid gap-8 lg:grid-cols-3">
              {relatedPosts.map((relatedPost) => (
                <PostCard
                  author={getAuthor(authors, relatedPost.data.authorId)}
                  key={relatedPost.id}
                  post={relatedPost}
                />
              ))}
            </div>
          </section>
        ) : null}
      </PageShell>
    </motion.article>
  )
}

function GetStartedPage() {
  const [activeTab, setActiveTab] = useState<'humans' | 'agents'>('humans')

  return (
    <PageShell>
      <SectionHeading
        copy="This demo intentionally shows both the developer path and the agent path, because WordClaw is designed for structured content operations across both."
        eyebrow="Get started"
        title="Integrating with WordClaw"
      />

      <div className="mb-12 flex overflow-x-auto border-b border-[var(--border)]">
        <button
          className={`px-6 py-3 text-sm font-semibold whitespace-nowrap transition-colors ${activeTab === 'humans' ? 'border-b-2 border-brand-500 text-[var(--foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
          onClick={() => setActiveTab('humans')}
        >
          For human developers
        </button>
        <button
          className={`px-6 py-3 text-sm font-semibold whitespace-nowrap transition-colors ${activeTab === 'agents' ? 'border-b-2 border-brand-500 text-[var(--foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
          onClick={() => setActiveTab('agents')}
        >
          For AI agents
        </button>
      </div>

      <div className="space-y-8">
        {activeTab === 'humans' ? (
          <>
            <section className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
              <h2 className="text-2xl font-semibold text-[var(--foreground)]">Define schemas first</h2>
              <p className="mt-4 leading-8 text-[var(--muted-foreground)]">
                The demo blog works because `demo-author` and `demo-blog-post` exist as explicit JSON schemas in WordClaw, while `demo-blog-settings` is seeded as a singleton global. The frontend does not hardcode fields blindly; it queries the runtime and renders published snapshots shaped by those models.
              </p>
            </section>

            <section className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
              <h2 className="text-2xl font-semibold text-[var(--foreground)]">Seed a realistic editorial domain</h2>
              <div className="mt-6 rounded-2xl border border-[#293246] bg-[#10131f]">
                <SyntaxHighlighter
                  customStyle={{ margin: 0, padding: '1.5rem', background: '#10131f' }}
                  language="bash"
                  style={atomDark}
                >
                  {`npm run demo:seed-blog
cd demos/demo-blog && npm run dev`}
                </SyntaxHighlighter>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
              <h2 className="text-2xl font-semibold text-[var(--foreground)]">Use MCP for discovery</h2>
              <p className="mt-4 leading-8 text-[var(--muted-foreground)]">
                Agents should discover capabilities, actor identity, and workspace targets before attempting to mutate content. WordClaw exposes that through MCP and the CLI guidance layer.
              </p>
            </section>

            <section className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
              <h2 className="text-2xl font-semibold text-[var(--foreground)]">Validate before writing</h2>
              <div className="mt-6 rounded-2xl border border-[#293246] bg-[#10131f]">
                <SyntaxHighlighter
                  customStyle={{ margin: 0, padding: '1.5rem', background: '#10131f' }}
                  language="bash"
                  style={atomDark}
                >
                  {`wordclaw content guide --content-type-id 12
wordclaw mcp call guide_task --json '{"taskId":"author-content"}'`}
                </SyntaxHighlighter>
              </div>
            </section>
          </>
        )}
      </div>
    </PageShell>
  )
}

function Layout({ children }: { children: ReactNode }) {
  const { settings } = useDemoData()
  const navItems = [
    { to: '/', label: 'Blog', icon: BookOpenText },
    { to: '/authors', label: 'Authors', icon: Users },
    { to: '/categories', label: 'Categories', icon: Shapes },
    { to: '/tags', label: 'Tags', icon: Tag },
    { to: '/archive', label: 'Archive', icon: Archive },
  ]

  return (
    <div className="min-h-screen bg-[var(--background)] font-sans text-[var(--foreground)] selection:bg-brand-500 selection:text-white">
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/88 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
          <Link className="flex items-center gap-3 text-xl font-bold tracking-tight text-[var(--foreground)] transition-opacity hover:opacity-80" to="/">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-white shadow-lg shadow-brand-500/25">
              <LayoutDashboard size={18} />
            </div>
            <div className="flex flex-col">
              <span>
                {settings?.siteTitle || 'WordClaw'} <span className="font-light text-brand-500">Demo</span>
              </span>
              <span className="hidden text-[0.65rem] font-medium uppercase tracking-[0.3em] text-[var(--muted-foreground)] md:block">
                {settings?.siteTagline || 'Published snapshots and schema-backed content'}
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 text-sm font-medium md:flex">
            {navItems.map((item) => (
              <NavLink
                className={({ isActive }) =>
                  isActive
                    ? 'text-brand-500'
                    : 'text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]'
                }
                key={item.to}
                to={item.to}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            <div className="hidden lg:block">
              <SemanticSearch />
            </div>
            <Link
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-brand-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
              to="/get-started"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-[var(--border)] bg-[var(--background)] py-12">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 text-sm text-[var(--muted-foreground)] sm:px-6 lg:px-8 md:flex-row md:items-center md:justify-between">
          <p>Built on WordClaw schemas, items, and agent-aware content workflows.</p>
          <div className="flex flex-wrap gap-4">
            <Link className="hover:text-brand-500" to="/archive">
              Archive
            </Link>
            <Link className="hover:text-brand-500" to="/authors">
              Authors
            </Link>
            <Link className="hover:text-brand-500" to="/tags">
              Tags
            </Link>
            <Link className="hover:text-brand-500" to="/get-started">
              Get Started
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function AppRoutes() {
  return (
    <Layout>
      <Routes>
        <Route
          element={
            <DemoStateBoundary>
              <HomePage />
            </DemoStateBoundary>
          }
          path="/"
        />
        <Route
          element={
            <DemoStateBoundary>
              <AuthorsPage />
            </DemoStateBoundary>
          }
          path="/authors"
        />
        <Route
          element={
            <DemoStateBoundary>
              <AuthorDetailPage />
            </DemoStateBoundary>
          }
          path="/author/:slug"
        />
        <Route
          element={
            <DemoStateBoundary>
              <CategoriesPage />
            </DemoStateBoundary>
          }
          path="/categories"
        />
        <Route
          element={
            <DemoStateBoundary>
              <TagsPage />
            </DemoStateBoundary>
          }
          path="/tags"
        />
        <Route
          element={
            <DemoStateBoundary>
              <CategoryDetailPage />
            </DemoStateBoundary>
          }
          path="/category/:categorySlug"
        />
        <Route
          element={
            <DemoStateBoundary>
              <TagDetailPage />
            </DemoStateBoundary>
          }
          path="/tag/:tagSlug"
        />
        <Route
          element={
            <DemoStateBoundary>
              <ArchivePage />
            </DemoStateBoundary>
          }
          path="/archive"
        />
        <Route
          element={
            <DemoStateBoundary>
              <PostDetailPage />
            </DemoStateBoundary>
          }
          path="/post/:slug"
        />
        <Route path="/get-started" element={<GetStartedPage />} />
      </Routes>
    </Layout>
  )
}

function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}

function SemanticSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: number, contentItemId: number, textChunk: string, similarity: number }[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const { posts } = useDemoData()

  useEffect(() => {
    const handler = setTimeout(async () => {
      if (!query.trim()) {
        setResults([])
        return
      }

      setIsLoading(true)
      try {
        const apiKey = import.meta.env.VITE_WORDCLAW_API_KEY || ''
        const res = await fetch(`${API_BASE}/search/semantic?query=${encodeURIComponent(query)}`, {
          headers: { 'x-api-key': apiKey }
        })
        const payload = await res.json()
        if (res.ok && payload.data) {
          setResults(payload.data)
        } else {
          setResults([])
        }
      } catch (err) {
        setResults([])
      } finally {
        setIsLoading(false)
      }
    }, 500)

    return () => clearTimeout(handler)
  }, [query])

  return (
    <div className="relative w-full xl:w-72">
      <div className="relative flex items-center">
        <Search className="absolute left-3 text-[var(--muted-foreground)]" size={16} />
        <input
          className="h-9 w-full rounded-full border border-[var(--border)] bg-[var(--background)]/50 pl-10 pr-4 text-sm text-[var(--foreground)] outline-none transition-all focus:border-brand-500 focus:bg-[var(--background)] focus:shadow-sm"
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Semantic search..."
          value={query}
        />
        {isLoading && (
          <Loader2 className="absolute right-3 animate-spin text-[var(--muted-foreground)]" size={16} />
        )}
      </div>

      {isOpen && query.trim() && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[calc(100vw-2rem)] shrink-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl sm:w-[28rem]">
          <div className="max-h-[24rem] overflow-y-auto p-2">
            {results.length === 0 && !isLoading ? (
              <p className="p-4 text-center text-sm text-[var(--muted-foreground)]">No relevant content found.</p>
            ) : (
              results.map((result) => {
                const post = posts.find((p) => p.id === result.contentItemId)
                if (!post) return null
                return (
                  <Link
                    className="block rounded-xl p-3 transition-colors hover:bg-[var(--background)]"
                    key={result.id}
                    to={`/post/${post.data.slug}`}
                  >
                    <p className="text-sm font-semibold text-[var(--foreground)]">{post.data.title}</p>
                    <p className="mt-1 line-clamp-2 border-l-2 border-brand-500 pl-2 text-xs text-[var(--muted-foreground)] opacity-80">
                      {result.textChunk}
                    </p>
                    <p className="mt-2 text-[10px] font-medium text-brand-500">
                      Relevance Score: {(result.similarity * 100).toFixed(1)}%
                    </p>
                  </Link>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <DemoDataProvider>
        <AppRoutes />
      </DemoDataProvider>
    </BrowserRouter>
  )
}

export default App
