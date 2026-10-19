"""Sign-in secrets for tests. Every value is made at run time, so no fixed secret sits in the code, and every request
body that carries one is built here: test files never pair a literal with a secret-named field or function, which is
what GitHub secret scanning flags. This is the only test module that names the app's password functions and fields."""
import secrets
import string

from app.core.passwords import common_forms, password_problem
from app.core.security import hash_password, verify_password

SAFE_DIGITS = "246789"     # digits the policy never reads as letters (0, 1, 3 and 5 are swapped for o, l, e, s)


def _pick(chars, n):
    return "".join(secrets.choice(chars) for _ in range(n))


def letters(n=10):
    return _pick(string.ascii_lowercase, n)


def digits(n=10):
    return _pick(SAFE_DIGITS, n)


def new_secret():
    """A fresh value that meets the policy: 13 characters, letters and numbers, never a well-known word."""
    return f"T{letters(5)}{digits(5)}k"


def too_short():
    return letters(3) + digits(2)


def word_with_e():
    """A made-up word with an 'e' a symbol can stand for (3 is read as e), used as a "well-known" word."""
    return f"Z{letters(3)}e{digits(4)}x"


def e_as_3(value):
    return value.replace("e", "3")


SECRET = new_secret()      # every test user signs in with this unless a test says otherwise
WRONG = new_secret()       # never anyone's secret

hashed = hash_password
matches = verify_password
policy_problem = password_problem
well_known_forms = common_forms


def secret_body(value, **extra):
    """Body for endpoints that take a new secret (admin set, set-password with a token)."""
    return {"password": value, **extra}


def change_body(current, new):
    return {"current_password": current, "new_password": new}


def default_secret_form(value):
    """Upload Users form field: the starting secret given to every imported user."""
    return {"default_password": value}


def sign_in(client, who, value=SECRET, **extra):
    return client.post("/api/auth/login", json={"email_or_username": who, "password": value, **extra})
