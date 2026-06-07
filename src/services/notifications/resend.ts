export async function sendNotification(subject: string, body: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const toEmail = process.env.RESEND_TO_EMAIL;

    if (!apiKey || !toEmail) return;

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: 'Trading Bot <onboarding@resend.dev>',
                to: [toEmail],
                subject,
                text: body,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Resend notification failed:', response.status, errorText);
        }
    } catch (error) {
        console.error('Resend notification error:', error);
    }
}

export function formatTimestamp(): string {
    const now = new Date();
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = now.getUTCFullYear();
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const min = String(now.getUTCMinutes()).padStart(2, '0');
    const ss = String(now.getUTCSeconds()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss} UTC`;
}
