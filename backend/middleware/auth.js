import jwt from 'jsonwebtoken';

export function auth(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({
            error: 'Sitzung abgelaufen, bitte erneut anmelden',
            code: 'session_expired'
        });
    }
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({
            error: 'Sitzung abgelaufen, bitte erneut anmelden',
            code: 'session_expired'
        });
    }
}

export function role(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role))
            return res.status(403).json({ error: 'Keine Berechtigung', code: 'forbidden' });
        next();
    };
}
