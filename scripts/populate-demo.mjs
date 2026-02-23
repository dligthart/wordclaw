const API_URL = 'http://localhost:4000/api';

async function request(endpoint, options = {}) {
    const url = `${API_URL}${endpoint}`;
    console.log(`\n\n--- [${options.method || 'GET'}] ${url} ---`);

    const res = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    });

    const status = res.status;
    let data;
    try {
        data = await res.json();
    } catch (e) {
        data = await res.text();
    }

    if (status >= 400) {
        console.error(`Error Payload: ${JSON.stringify(data, null, 2)}`);
    } else {
        console.log(`Status: ${status}`);
    }

    return { status, data };
}

async function populateDemo() {
    console.log("Starting WordClaw Demo Population Script...");

    // ==========================================
    // 1. Create Author Content Type
    // ==========================================
    const authorSchema = {
        type: "object",
        properties: {
            name: { type: "string", description: "Author's full name" },
            slug: { type: "string", description: "URL-friendly author slug" },
            bio: { type: "string", description: "Short biography" },
            avatarUrl: { type: "string", description: "URL to avatar image" },
            socialLinks: {
                type: "array",
                items: { type: "string" },
                description: "List of social media URLs"
            }
        },
        required: ["name", "slug", "bio"]
    };

    // Fetch CT to get ID (in case it already existed)
    let ctListRes = await request('/content-types');
    let authorCtId = ctListRes.data?.data?.find(ct => ct.slug === 'demo-author')?.id;

    if (!authorCtId) {
        console.log("Creating Author Content Type...");
        const authorCtRes = await request('/content-types', {
            method: 'POST',
            body: JSON.stringify({
                name: "Demo Author",
                slug: "demo-author",
                schema: JSON.stringify(authorSchema)
            })
        });

        if (authorCtRes.status !== 200 && authorCtRes.status !== 201) {
            console.error("Failed to create Author content type.");
            return;
        }
        authorCtId = authorCtRes.data.data.id;
    }

    console.log(`Author Content Type ID: ${authorCtId}`);

    // ==========================================
    // 2. Insert Authors
    // ==========================================
    const authors = [
        {
            name: "Sarah Jenkins",
            slug: "sarah-jenkins",
            bio: "Lead Designer at Paradigmhift. Obsessed with micro-interactions and neo-brutalism.",
            avatarUrl: "https://i.pravatar.cc/150?u=sarah",
            socialLinks: ["https://twitter.com/sarahdesign"]
        },
        {
            name: "Marcus Aurelius",
            slug: "marcus-aurelius",
            bio: "Full-stack wizard. Writing about code architecture, API design, and scaling systems.",
            avatarUrl: "https://i.pravatar.cc/150?u=marcus",
            socialLinks: ["https://github.com/marcuscode"]
        }
    ];

    const authorIds = {};
    for (const author of authors) {
        console.log(`Inserting Author: ${author.name}`);
        const res = await request(`/content-items`, {
            method: 'POST',
            body: JSON.stringify({
                contentTypeId: authorCtId,
                data: author,
                status: "published"
            })
        });
        if (res.status === 200 || res.status === 201) {
            // Store the assigned UUID 
            authorIds[author.slug] = res.data.data.id;
        }
    }

    // ==========================================
    // 3. Create Blog Post Content Type
    // ==========================================
    const postSchema = {
        type: "object",
        properties: {
            title: { type: "string" },
            slug: { type: "string" },
            excerpt: { type: "string" },
            content: { type: "string" },
            coverImage: { type: "string" },
            authorId: { type: "number", description: "Reference to Author Content Item ID" },
            category: { type: "string", enum: ["Design", "Engineering", "AI", "Productivity"] },
            tags: { type: "array", items: { type: "string" } },
            readTimeMinutes: { type: "number" }
        },
        required: ["title", "slug", "content", "authorId", "category"]
    };

    ctListRes = await request('/content-types');
    let postCtId = ctListRes.data?.data?.find(ct => ct.slug === 'demo-blog-post')?.id;
    if (!postCtId) {
        console.log("Creating Blog Post Content Type...");
        const postCtRes = await request('/content-types', {
            method: 'POST',
            body: JSON.stringify({
                name: "Demo Blog Post",
                slug: "demo-blog-post",
                schema: JSON.stringify(postSchema)
            })
        });

        if (postCtRes.status !== 200 && postCtRes.status !== 201) {
            console.error("Failed to create Blog Post content type.");
            return;
        }
        postCtId = postCtRes.data.data.id;
    }
    console.log(`Blog Post Content Type ID: ${postCtId}`);

    // ==========================================
    // 4. Insert Blog Posts
    // ==========================================
    const mockContent = `
## Introduction
This is an amazing time to be building on the web. The culmination of modern frameworks, edge computing, and beautiful, utility-first CSS empowers developers to create experiences that were previously unimaginable.

### The Role of Design
Design isn't just how a product looks, but how it works. A seamless user experience is critical for retention. We must focus on:
- Micro-interactions that delight users
- Consistent spacing and typography
- Performance as a design feature

### Looking Forward
As we integrate more AI into our daily workflows, the fundamental principles of good engineering remain the same. Clean APIs, robust data models, and stateless frontends architecture will continue to thrive.

> "Simplicity is the ultimate sophistication." - Leonardo da Vinci
    `;

    const posts = [
        {
            title: "The Rise of Agentic CMS Platforms",
            slug: "agentic-cms-platforms",
            excerpt: "How headless content management systems are evolving to serve not just humans, but AI agents orchestrating data.",
            content: mockContent,
            coverImage: "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&q=80&w=2070",
            authorId: authorIds["marcus-aurelius"],
            category: "AI",
            tags: ["Agents", "CMS", "Future"],
            readTimeMinutes: 5
        },
        {
            title: "Designing for the Void: Dark Mode by Default",
            slug: "designing-dark-mode-default",
            excerpt: "Why premium applications are moving towards sophisticated, low-contrast dark themes out of the box.",
            content: mockContent,
            coverImage: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&q=80&w=2070",
            authorId: authorIds["sarah-jenkins"],
            category: "Design",
            tags: ["UI", "UX", "Trends"],
            readTimeMinutes: 4
        },
        {
            title: "TypeScript Monorepos for the Modern Web",
            slug: "typescript-monorepos-modern-web",
            excerpt: "Organizing your codebase across frontend apps and backend services to maximize code reuse and type safety.",
            content: mockContent,
            coverImage: "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&q=80&w=2070",
            authorId: authorIds["marcus-aurelius"],
            category: "Engineering",
            tags: ["TypeScript", "Architecture", "Scaling"],
            readTimeMinutes: 8
        },
        {
            title: "Fluid Typography Scaling Systems",
            slug: "fluid-typography-scaling",
            excerpt: "Implementing CSS clamp functions to create truly responsive, screen-agnostic type hierarchies.",
            content: mockContent,
            coverImage: "https://images.unsplash.com/photo-1506452815077-0a233c7c11c1?auto=format&fit=crop&q=80&w=2075",
            authorId: authorIds["sarah-jenkins"],
            category: "Design",
            tags: ["CSS", "Design Systems"],
            readTimeMinutes: 3
        }
    ];

    for (const post of posts) {
        console.log(`Inserting Post: ${post.title}`);
        await request(`/content-items`, {
            method: 'POST',
            body: JSON.stringify({
                contentTypeId: postCtId,
                data: post,
                status: "published"
            })
        });
    }

    console.log("\nDemo population complete!");
}

populateDemo().catch(console.error);
