import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Link, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { LayoutDashboard, ArrowLeft, Clock, User, ChevronRight } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

// Types
interface Author {
  id: number;
  data: {
    name: string;
    slug: string;
    avatarUrl: string;
    bio: string;
    socialLinks: string[];
  };
}

interface BlogPost {
  id: number;
  data: {
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    coverImage: string;
    authorId: number;
    category: string;
    tags: string[];
    readTimeMinutes: number;
  };
  createdAt: string;
}

const API_BASE = 'http://localhost:4000/api'

// Fetch Helpers
const useWordClawData = () => {
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [authors, setAuthors] = useState<Author[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadData = async () => {
      try {
        const [ctRes, authorsRes] = await Promise.all([
          fetch(`${API_BASE}/content-types`).then(res => res.json()),
          fetch(`${API_BASE}/content-items`).then(res => res.json()) // Temp fetch everything
        ])

        const types = ctRes.data || [];
        const authorType = types.find((t: any) => t.slug === 'demo-author');
        const postType = types.find((t: any) => t.slug === 'demo-blog-post');

        if (authorType && postType) {
          const [fetchedAuthors, fetchedPosts] = await Promise.all([
            fetch(`${API_BASE}/content-items?contentTypeId=${authorType.id}`).then(res => res.json()),
            fetch(`${API_BASE}/content-items?contentTypeId=${postType.id}`).then(res => res.json())
          ])
          setAuthors(fetchedAuthors.data.map((item: any) => ({ ...item, data: JSON.parse(item.data) })))
          setPosts(fetchedPosts.data.map((item: any) => ({ ...item, data: JSON.parse(item.data) })))
        }
      } catch (err) {
        console.error("Failed to fetch data from WordClaw", err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  return { posts, authors, loading }
}

// Components
const Layout = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen bg-[var(--background)] flex flex-col font-sans selection:bg-brand-500 selection:text-white">
    <header className="sticky top-0 z-50 w-full border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-md">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-xl font-bold tracking-tight text-[var(--foreground)] hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-white shadow-lg shadow-brand-500/30">
            <LayoutDashboard size={18} />
          </div>
          WordClaw <span className="text-brand-500 font-light">Demo</span>
        </Link>
        <nav className="hidden md:flex gap-6 text-sm font-medium text-gray-500 dark:text-gray-400">
          <a href="#" className="hover:text-brand-500 transition-colors">Products</a>
          <a href="#" className="hover:text-brand-500 transition-colors">Solutions</a>
          <a href="#" className="hover:text-brand-500 transition-colors">Resources</a>
          <a href="#" className="text-brand-500">Blog</a>
        </nav>
        <Link to="/get-started" className="hidden md:flex h-9 items-center justify-center rounded-full bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500">
          Get Started
        </Link>
      </div>
    </header>
    <main className="flex-1 w-full flex flex-col items-center">
      {children}
    </main>
    <footer className="w-full border-t border-[var(--border)] py-12 bg-gray-50 dark:bg-[#0c0c0e]">
      <div className="container mx-auto px-4 text-center text-sm text-gray-500">
        <p>© 2026 WordClaw Framework Demo. All rights reserved.</p>
      </div>
    </footer>
  </div>
)

const PostCard = ({ post, author }: { post: BlogPost, author?: Author }) => {
  return (
    <Link to={`/post/${post.data.slug}`}>
      <motion.article
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        whileHover={{ y: -5 }}
        className="group relative flex flex-col items-start justify-between rounded-2xl bg-[var(--card)] p-4 sm:p-6 shadow-sm border border-[var(--border)] hover:shadow-xl hover:shadow-brand-500/5 transition-all duration-300"
      >
        <div className="relative w-full aspect-[16/9] sm:aspect-[2/1] lg:aspect-[3/2] overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800 mb-6">
          <img
            src={post.data.coverImage}
            alt={post.data.title}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute top-4 left-4">
            <span className="inline-flex items-center rounded-full bg-white/90 backdrop-blur-sm px-3 py-1 text-xs font-medium text-brand-700 shadow-sm ring-1 ring-inset ring-brand-700/10">
              {post.data.category}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-x-4 text-xs text-gray-500 mb-4">
          <time dateTime={post.createdAt} className="flex items-center gap-1">
            <Clock size={14} />
            {new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </time>
          <span className="flex items-center gap-1">
            {post.data.readTimeMinutes} min read
          </span>
        </div>

        <div className="group relative">
          <h3 className="mt-3 text-xl font-semibold leading-6 text-[var(--foreground)] group-hover:text-brand-500 transition-colors line-clamp-2">
            {post.data.title}
          </h3>
          <p className="mt-3 line-clamp-3 text-sm leading-6 text-gray-600 dark:text-gray-400">
            {post.data.excerpt}
          </p>
        </div>

        {author && (
          <div className="relative mt-8 flex items-center gap-x-4">
            <img src={author.data.avatarUrl} alt="" className="h-10 w-10 rounded-full bg-gray-50 ring-2 ring-white dark:ring-gray-900 object-cover" />
            <div className="text-sm leading-6">
              <p className="font-semibold text-[var(--foreground)]">
                {author.data.name}
              </p>
            </div>
          </div>
        )}
      </motion.article>
    </Link>
  )
}

const Index = () => {
  const { posts, authors, loading } = useWordClawData()

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-brand-500"></div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      <div className="mx-auto max-w-2xl text-center mb-16 sm:mb-20">
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-bold tracking-tight text-[var(--foreground)] sm:text-5xl lg:text-6xl mb-6"
        >
          From the <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-brand-600">WordClaw</span> Desk
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mt-2 text-lg leading-8 text-gray-600 dark:text-gray-400 max-w-xl mx-auto"
        >
          Insights on headless architecture, agentic workflows, and the future of connected digital experiences.
        </motion.p>
      </div>

      <div className="mx-auto grid max-w-2xl grid-cols-1 gap-x-8 gap-y-16 lg:max-w-none lg:grid-cols-3">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            author={authors.find(a => a.id === post.data.authorId)}
          />
        ))}
      </div>
    </div>
  )
}

const PostDetail = () => {
  const { slug } = useParams()
  const { posts, authors, loading } = useWordClawData()

  if (loading) return <div className="min-h-[60vh] flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-brand-500"></div></div>

  const post = posts.find(p => p.data.slug === slug)
  if (!post) return <div className="py-24 text-center">Post not found</div>

  const author = authors.find(a => a.id === post.data.authorId)

  return (
    <motion.article
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-20"
    >
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-brand-500 mb-8 transition-colors">
        <ArrowLeft size={16} /> Back to blog
      </Link>

      <div className="flex items-center gap-x-4 text-sm text-gray-500 mb-6">
        <span className="inline-flex items-center rounded-full bg-brand-50 dark:bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-700 dark:text-brand-400">
          {post.data.category}
        </span>
        <time dateTime={post.createdAt} className="flex items-center gap-1">
          {new Date(post.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </time>
        <span>·</span>
        <span>{post.data.readTimeMinutes} min read</span>
      </div>

      <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-[var(--foreground)] mb-8 leading-tight">
        {post.data.title}
      </h1>

      {author && (
        <div className="flex items-center gap-4 mb-12 py-6 border-y border-[var(--border)]">
          <img src={author.data.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover bg-gray-50 ring-2 ring-white dark:ring-gray-900" />
          <div>
            <div className="font-semibold text-[var(--foreground)] text-lg">{author.data.name}</div>
            <div className="text-gray-500 text-sm">{author.data.bio}</div>
          </div>
        </div>
      )}

      <div className="w-full aspect-[2/1] bg-gray-100 dark:bg-gray-800 rounded-2xl overflow-hidden mb-12 shadow-lg shadow-black/5">
        <img src={post.data.coverImage} className="w-full h-full object-cover" alt="Cover" />
      </div>

      <div
        className="prose prose-lg dark:prose-invert prose-brand max-w-none prose-headings:font-bold prose-a:text-brand-500 hover:prose-a:text-brand-600 prose-img:rounded-xl"
        dangerouslySetInnerHTML={{
          // Replaces basic markdown # syntax with minimal HTML just for the demo
          __html: post.data.content
            .replace(/### (.*)/g, '<h3>$1</h3>')
            .replace(/## (.*)/g, '<h2>$1</h2>')
            .replace(/- (.*)/g, '<li>$1</li>')
            .replace(/> "(.*)" - (.*)/g, '<blockquote className="border-l-4 border-brand-500 pl-4 italic my-6 bg-brand-50 dark:bg-brand-500/5 p-4 rounded-r-lg"><p>"$1"</p><footer className="mt-2 font-semibold text-sm text-brand-600">— $2</footer></blockquote>')
            .replace(/\n\n/g, '<br/>')
        }}
      />

      <div className="mt-16 pt-8 border-t border-[var(--border)]">
        <h3 className="font-semibold text-lg mb-4">Tags</h3>
        <div className="flex gap-2 flex-wrap">
          {post.data.tags.map(tag => (
            <span key={tag} className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full text-sm">
              #{tag}
            </span>
          ))}
        </div>
      </div>
    </motion.article>
  )
}

const GetStarted = () => {
  const [activeTab, setActiveTab] = useState<'humans' | 'agents'>('humans')

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24"
    >
      <div className="mb-12">
        <h1 className="text-4xl font-bold tracking-tight text-[var(--foreground)] mb-6">
          Integrating with WordClaw
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-400">
          WordClaw is built from the ground up to serve both human developers and autonomous AI agents. Select your integration mode below.
        </p>
      </div>

      <div className="flex border-b border-[var(--border)] mb-12 overflow-x-auto">
        <button
          className={`px-6 py-3 font-semibold text-sm focus:outline-none whitespace-nowrap transition-colors ${activeTab === 'humans' ? 'border-b-2 border-brand-500 text-[var(--foreground)]' : 'text-gray-500 hover:text-[var(--foreground)]'}`}
          onClick={() => setActiveTab('humans')}
        >
          For Human Developers
        </button>
        <button
          className={`px-6 py-3 font-semibold text-sm focus:outline-none whitespace-nowrap transition-colors ${activeTab === 'agents' ? 'border-b-2 border-brand-500 text-[var(--foreground)]' : 'text-gray-500 hover:text-[var(--foreground)]'}`}
          onClick={() => setActiveTab('agents')}
        >
          For AI Agents (MCP)
        </button>
      </div>

      <div className="space-y-12">
        {activeTab === 'humans' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-12">
            <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-8 shadow-sm">
              <h2 className="text-2xl font-semibold mb-4 text-[var(--foreground)]">1. Defining Schemas</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                In WordClaw, you define the structure of your data using JSON Schema. For this blog, we created two Content Types via the WordClaw API: <strong>Demo Author</strong> and <strong>Demo Blog Post</strong>.
              </p>
              <ul className="list-disc pl-6 text-gray-600 dark:text-gray-400 space-y-2 mb-6">
                <li><strong>Demo Author:</strong> Has fields for name, slug, bio, and avatarUrl.</li>
                <li><strong>Demo Blog Post:</strong> Has fields for title, slug, excerpt, content, coverImage, category, tags, and crucially, an <code>authorId</code>.</li>
              </ul>
              <div className="rounded-xl overflow-hidden shadow-lg border border-gray-800">
                <SyntaxHighlighter language="json" style={atomDark} customStyle={{ margin: 0, padding: '1.5rem', fontSize: '14px', background: '#121214' }}>
                  {`// Example: Relating Post to Author in Schema\n{\n  "authorId": { \n    "type": "number", \n    "description": "Reference to Author Content Item ID" \n  }\n}`}
                </SyntaxHighlighter>
              </div>
            </section>

            <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-8 shadow-sm">
              <h2 className="text-2xl font-semibold mb-4 text-[var(--foreground)]">2. Fetching Content</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                Since WordClaw provides a REST API, getting your content is as simple as making HTTP requests. This demo uses a custom React hook to fetch the Content Types first, then fetches the underlying Content Items to build relationships.
              </p>
              <div className="rounded-xl overflow-hidden shadow-lg border border-gray-800">
                <SyntaxHighlighter language="javascript" style={atomDark} customStyle={{ margin: 0, padding: '1.5rem', fontSize: '14px', background: '#121214' }}>
                  {`// 1. Get the list of all Content Types\nconst types = await fetch('/api/content-types').then(r => r.json())\nconst postType = types.data.find(t => t.slug === 'demo-blog-post')\n\n// 2. Fetch the corresponding items using the ContentType ID\nconst posts = await fetch('/api/content-items?contentTypeId=' + postType.id)`}
                </SyntaxHighlighter>
              </div>
            </section>

            <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-8 shadow-sm">
              <h2 className="text-2xl font-semibold mb-4 text-[var(--foreground)]">3. Normalizing Data</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                WordClaw stores dynamic content inside a JSONB column on the backend. When consuming the REST API directly, you need to parse the <code>data</code> field back into an object in your frontend state.
              </p>
              <div className="rounded-xl overflow-hidden shadow-lg border border-gray-800">
                <SyntaxHighlighter language="javascript" style={atomDark} customStyle={{ margin: 0, padding: '1.5rem', fontSize: '14px', background: '#121214' }}>
                  {`// The item.data comes back as a stringified JSON payload\nconst parsedPosts = fetchedPosts.data.map(item => ({\n  ...item,\n  data: JSON.parse(item.data)\n}))`}
                </SyntaxHighlighter>
              </div>
            </section>
          </motion.div>
        )}

        {activeTab === 'agents' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-12">
            <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-8 shadow-sm">
              <h2 className="text-2xl font-semibold mb-4 text-[var(--foreground)]">1. Model Context Protocol (MCP)</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                AI Agents don't need to write raw HTTP requests to integrate. WordClaw runs a deeply integrated <strong>MCP Server</strong>, allowing agents to natively discover and interact with the semantic rules of your content models.
              </p>
              <div className="rounded-xl overflow-hidden shadow-lg border border-gray-800">
                <SyntaxHighlighter language="json" style={atomDark} customStyle={{ margin: 0, padding: '1.5rem', fontSize: '14px', background: '#121214' }}>
                  {`// In your Claude Desktop config (claude_desktop_config.json)\n{\n  "mcpServers": {\n    "wordclaw": {\n      "command": "node",\n      "args": ["/path/to/wordclaw/dist/mcp/index.js"]\n    }\n  }\n}`}
                </SyntaxHighlighter>
              </div>
              <p className="text-gray-600 dark:text-gray-400 mt-4 leading-relaxed">Once connected, the agent gets immediate access to tools like <code>list_content_types</code> and <code>create_content_item</code>.</p>
            </section>

            <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-8 shadow-sm">
              <h2 className="text-2xl font-semibold mb-4 text-[var(--foreground)]">2. Dry-Run Validation</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                As an agent, mutating records in a CMS can be destructive. WordClaw exposes a <code>?mode=dry_run</code> parameter across all state-mutating endpoints, letting the agent validate schemas strictly without affecting production data.
              </p>
              <div className="rounded-xl overflow-hidden shadow-lg border border-gray-800">
                <SyntaxHighlighter language="bash" style={atomDark} customStyle={{ margin: 0, padding: '1.5rem', fontSize: '14px', background: '#121214' }}>
                  {`# The agent tests its payload generation against the JSON Schema\ncurl -X POST "http://localhost:4000/api/content-items?mode=dry_run" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "contentTypeId": 12, \n    "data": {"title": "Test", "authorId": "Bob"} \n  }'\n\n# The API replies securely with an intuitive 400 error \n# catching hallucinations instantly if authorId was expected to be a number.`}
                </SyntaxHighlighter>
              </div>
            </section>

            <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-8 shadow-sm">
              <h2 className="text-2xl font-semibold mb-4 text-[var(--foreground)]">3. Vector Generation</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                WordClaw natively hooks into semantic generation endpoints. Every time content is published, an AI agent operates synchronously in the backend to index the content into vector space for RAG retrievals automatically.
              </p>
            </section>
          </motion.div>
        )}

        <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-8 shadow-sm">
          <h2 className="text-2xl font-semibold mb-4 text-[var(--foreground)]">Next Steps</h2>
          <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
            Explore the <a href="https://github.com/dligthart/wordclaw" target="_blank" className="text-brand-500 hover:underline inline-flex items-center gap-1">WordClaw documentation</a> to learn about more advanced features such as Workflows, Webhooks, AI Vector Embeddings, and the MCP Agent Server.
          </p>
          <div className="flex justify-start">
            <Link to="/" className="inline-flex items-center gap-2 font-medium text-brand-600 dark:text-brand-400 hover:text-brand-500 transition-colors">
              <ArrowLeft size={16} /> Back to the Demo Blog
            </Link>
          </div>
        </section>
      </div>
    </motion.div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/post/:slug" element={<PostDetail />} />
          <Route path="/get-started" element={<GetStarted />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

export default App
