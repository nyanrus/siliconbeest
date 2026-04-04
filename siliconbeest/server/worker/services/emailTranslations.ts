/**
 * Server-side email translations for multilingual email delivery.
 *
 * Each locale has strings for every email type. Falls back to 'en'
 * for unsupported locales.
 */

export interface AccountWarningStrings {
	subject: string;
	heading: string;
	description: string;
}

export interface EmailStrings {
	confirmation: {
		subject: (title: string) => string;
		heading: (title: string) => string;
		body: string;
		expiry: string;
	};
	passwordReset: {
		subject: string;
		heading: string;
		body: string;
		expiry: string;
	};
	welcome: {
		subject: (title: string) => string;
		heading: (title: string) => string;
		body: string;
	};
	rejection: {
		subject: string;
		heading: string;
		body: (title: string) => string;
	};
	accountWarning: Record<string, AccountWarningStrings>;
	reasonLabel: string;
}

function makeTranslation(title: string, str: (title: string) => string): string {
	return str(title);
}

const translations: Record<string, EmailStrings> = {
	en: {
		confirmation: {
			subject: (title) => `Confirm your email - ${title}`,
			heading: (title) => `Confirm your email - ${title}`,
			body: 'Click the link below to confirm your email address:',
			expiry: 'This link expires in 24 hours.',
		},
		passwordReset: {
			subject: 'Reset your password',
			heading: 'Password Reset',
			body: 'Click the link below to reset your password:',
			expiry: 'This link expires in 1 hour.',
		},
		welcome: {
			subject: (title) => `Welcome to ${title}!`,
			heading: (title) => `Welcome to ${title}!`,
			body: 'Your account has been approved.',
		},
		rejection: {
			subject: 'Registration update',
			heading: 'Registration Update',
			body: (title) => `Your registration at ${title} was not approved at this time.`,
		},
		accountWarning: {
			warn: {
				subject: 'Account Warning',
				heading: 'Account Warning',
				description: 'An administrator has sent a warning to your account.',
			},
			disable: {
				subject: 'Account Frozen',
				heading: 'Account Frozen',
				description: 'An administrator has frozen your account. Login is restricted.',
			},
			silence: {
				subject: 'Account Limited',
				heading: 'Account Limited',
				description: 'An administrator has limited your account. Your posts will only be visible to your followers.',
			},
			suspend: {
				subject: 'Account Suspended',
				heading: 'Account Suspended',
				description: 'An administrator has suspended your account. You can no longer use this account.',
			},
			sensitive: {
				subject: 'Media Marked Sensitive',
				heading: 'Media Marked Sensitive',
				description: 'An administrator has marked your media as sensitive content.',
			},
			none: {
				subject: 'Account Warning',
				heading: 'Account Warning',
				description: 'An administrator has sent a warning to your account.',
			},
		},
		reasonLabel: 'Reason',
	},
	ko: {
		confirmation: {
			subject: (title) => `이메일 인증 - ${title}`,
			heading: (title) => `이메일 인증 - ${title}`,
			body: '아래 링크를 클릭하여 이메일 주소를 인증해 주세요:',
			expiry: '이 링크는 24시간 후에 만료됩니다.',
		},
		passwordReset: {
			subject: '비밀번호 재설정',
			heading: '비밀번호 재설정',
			body: '아래 링크를 클릭하여 비밀번호를 재설정해 주세요:',
			expiry: '이 링크는 1시간 후에 만료됩니다.',
		},
		welcome: {
			subject: (title) => `${title}에 오신 것을 환영합니다!`,
			heading: (title) => `${title}에 오신 것을 환영합니다!`,
			body: '회원님의 계정이 승인되었습니다.',
		},
		rejection: {
			subject: '가입 심사 결과',
			heading: '가입 심사 결과',
			body: (title) => `${title} 가입 신청이 현재 승인되지 않았습니다.`,
		},
		accountWarning: {
			warn: {
				subject: '계정 경고',
				heading: '계정 경고',
				description: '관리자가 회원님의 계정에 경고를 보냈습니다.',
			},
			disable: {
				subject: '계정 동결',
				heading: '계정 동결',
				description: '관리자가 회원님의 계정을 동결했습니다. 로그인이 제한됩니다.',
			},
			silence: {
				subject: '계정 제한',
				heading: '계정 제한',
				description: '관리자가 회원님의 계정을 제한했습니다. 게시물이 팔로워에게만 표시됩니다.',
			},
			suspend: {
				subject: '계정 정지',
				heading: '계정 정지',
				description: '관리자가 회원님의 계정을 정지했습니다. 더 이상 이 계정을 사용할 수 없습니다.',
			},
			sensitive: {
				subject: '미디어 민감 표시',
				heading: '미디어 민감 표시',
				description: '관리자가 회원님의 미디어를 민감한 콘텐츠로 표시했습니다.',
			},
			none: {
				subject: '계정 경고',
				heading: '계정 경고',
				description: '관리자가 회원님의 계정에 경고를 보냈습니다.',
			},
		},
		reasonLabel: '사유',
	},
};

/**
 * Get email translations for a given locale. Falls back to English
 * if the locale is not available.
 */
export function getEmailTranslations(locale: string): EmailStrings {
	return translations[locale] || translations.en;
}
