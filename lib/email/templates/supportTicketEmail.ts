export const getSupportTicketEmailHtml = (name: string, ticketId: string, subject: string, category: string, message: string, dashboardUrl: string) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Support Ticket Received</title>
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
        .ticket-info {
            background-color: #f3f4ff;
            border-left: 4px solid #6366f1;
            padding: 20px;
            margin: 24px 0;
            border-radius: 0 8px 8px 0;
        }
        .ticket-info p {
            margin: 0 0 12px 0;
            color: #374151;
            font-size: 15px;
        }
        .ticket-info p:last-child {
            margin: 0;
        }
        .ticket-info strong {
            color: #111827;
            display: inline-block;
            width: 80px;
        }
        .message-box {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            padding: 24px;
            border-radius: 12px;
            margin: 24px 0;
            font-size: 15px;
            color: #4b5563;
            white-space: pre-wrap;
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
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>VELLUM</h1>
        </div>
        <div class="content">
            <p class="greeting">Hi ${name},</p>
            <p>We have received your support request. Our team has been notified and we will get back to you within 24-48 hours.</p>
            
            <div class="ticket-info">
                <p><strong>Ticket ID:</strong> ${ticketId}</p>
                <p><strong>Category:</strong> ${category.toUpperCase()}</p>
                <p><strong>Subject:</strong> ${subject}</p>
            </div>

            <p style="text-transform: uppercase; font-size: 12px; font-weight: 700; color: #9ca3af; letter-spacing: 0.05em; margin-bottom: -16px;">Your Message</p>
            <div class="message-box">
                ${message.replace(/\n/g, '<br>')}
            </div>

            <p>If you have any additional information to add, please hold on until a support agent reaches out to you via this email.</p>

            <a href="${dashboardUrl}/dashboard/help" class="cta-button">Visit Help Center</a>

        </div>
        <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Vellum. All rights reserved.</p>
            <p style="font-size: 12px; margin-top: 8px;">Built with Next.js, MongoDB, and Redux for the modern professional.</p>
        </div>
    </div>
</body>
</html>
`;
