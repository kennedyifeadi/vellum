export const getWelcomeEmailHtml = (name: string, dashboardUrl: string) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Vellum</title>
    <style>
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #1a1a1a;
            margin: 0;
            padding: 0;
            background-color: #f8fafc;
        }
        .container {
            max-width: 600px;
            margin: 40px auto;
            background: #ffffff;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        .header {
            background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
            padding: 40px;
            text-align: center;
        }
        .header h1 {
            color: #ffffff;
            margin: 0;
            font-size: 28px;
            font-weight: 800;
            letter-spacing: -0.025em;
            text-transform: uppercase;
        }
        .content {
            padding: 40px;
        }
        .greeting {
            font-size: 20px;
            font-weight: 600;
            color: #111827;
            margin-bottom: 16px;
        }
        .mission {
            background-color: #f3f4ff;
            border-left: 4px solid #6366f1;
            padding: 20px;
            margin: 24px 0;
            font-style: italic;
            color: #374151;
        }
        .features {
            margin: 32px 0;
            padding: 0;
            list-style: none;
        }
        .feature-item {
            margin-bottom: 24px;
            display: flex;
            align-items: flex-start;
        }
        .feature-icon {
            background: #eff6ff;
            color: #2563eb;
            width: 40px;
            height: 40px;
            border-radius: 10px;
            text-align: center;
            line-height: 40px;
            margin-right: 20px;
            flex-shrink: 0;
            font-size: 20px;
        }
        .feature-text b {
            display: block;
            color: #111827;
            margin-bottom: 4px;
            font-size: 16px;
        }
        .feature-text p {
            margin: 0;
            color: #4b5563;
            font-size: 14px;
        }
        .cta-button {
            display: block;
            background: #6366f1;
            color: #ffffff !important;
            padding: 16px 32px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            margin-top: 32px;
            text-align: center;
            transition: background 0.2s;
        }
        .footer {
            padding: 32px 40px;
            background: #f9fafb;
            border-top: 1px solid #f1f5f9;
            text-align: center;
        }
        .footer p {
            font-size: 14px;
            color: #6b7280;
            margin: 0;
        }
        .signature {
            margin-top: 32px;
            padding-top: 24px;
            border-top: 1px solid #f1f5f9;
            text-align: left;
            color: #374151;
            font-size: 15px;
        }
        .highlight {
            color: #6366f1;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>VELLUM</h1>
        </div>
        <div class="content">
            <p class="greeting">Welcome to the family, ${name}! 👋</p>
            <p>I'm <span class="highlight">JFK</span>, and I'm thrilled to have you join Vellum.</p>
            
            <div class="mission">
                "Our mission is to provide a frictionless document workspace for professionals—software engineers, designers, and managers—who need reliable tools that feel like a natural extension of their workflow."
            </div>

            <p>Vellum is a high-performance, full-stack document utility platform designed to simplify complex file transformations with a premium, professional user experience. Here's what you can achieve in your new workspace:</p>
            
            <div class="features">
                <div class="feature-item">
                    <div class="feature-icon">📄</div>
                    <div class="feature-text">
                        <b>PDF Mastery</b>
                        <p>High-speed PDF manipulation including merging, splitting, locking, and text-search capabilities.</p>
                    </div>
                </div>
                <div class="feature-item">
                    <div class="feature-icon">🖼️</div>
                    <div class="feature-text">
                        <b>Image Processing</b>
                        <p>High-performance server-side rendering for Image-to-PDF and format conversions.</p>
                    </div>
                </div>
                <div class="feature-item">
                    <div class="feature-icon">🌉</div>
                    <div class="feature-text">
                        <b>Document Bridge</b>
                        <p>Accurate transformations between DOCX, HTML, and PDF formats through our optimized pipelines.</p>
                    </div>
                </div>
                <div class="feature-item">
                    <div class="feature-icon">📁</div>
                    <div class="feature-text">
                        <b>File Management</b>
                        <p>Persistent tracking and easy retrieval of your personal history and "My Files" storage.</p>
                    </div>
                </div>
            </div>

            <p>We've combined the power of low-level file manipulation with a sophisticated, animation-rich interface to ensure your document management is both powerful and beautiful.</p>

            <a href="${dashboardUrl}" class="cta-button">Go to your Dashboard</a>

            <div class="signature">
                Best regards,<br>
                <strong>JFK</strong><br>
                Founder, Vellum
            </div>
        </div>
        <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Vellum. All rights reserved.</p>
            <p style="font-size: 12px; margin-top: 8px;">Built with Next.js, MongoDB, and Redux for the modern professional.</p>
        </div>
    </div>
</body>
</html>
`;
