const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

export interface Template { id: string; name: string; blurb: string; signers: string[]; markdown: string }

export const TEMPLATES: Template[] = [
  {
    id: "blank", name: "Blank", blurb: "Start from nothing.", signers: [],
    markdown: `# Untitled agreement\n\n`,
  },
  {
    id: "nda", name: "Mutual NDA", blurb: "Two-way confidentiality, 3-year term.", signers: ["Party A", "Party B"],
    markdown: `# Mutual Non-Disclosure Agreement

**Effective date:** ${today}

This Agreement is entered into between **Party A** and **Party B** (each a "Party").

## 1. Purpose
The Parties wish to explore a business relationship (the "Purpose") and may disclose confidential information to each other.

## 2. Confidential Information
"Confidential Information" means any non-public information disclosed by a Party, in any form, that is marked confidential or would reasonably be understood to be confidential.

## 3. Obligations
Each receiving Party shall:

- use Confidential Information solely for the Purpose;
- protect it with at least the care it uses for its own confidential information, and no less than reasonable care;
- not disclose it to any third party without the disclosing Party's prior written consent.

## 4. Exclusions
Obligations do not apply to information that is or becomes public through no fault of the receiving Party, was lawfully known before disclosure, or is independently developed.

## 5. Term
These obligations survive for **three (3) years** from the effective date.

## 6. Signatures

**Party A**
[[text: Party A | Full legal name]]
[[text: Party A | Company]]
[[sign: Party A]]
[[date: Party A]]

**Party B**
[[text: Party B | Full legal name]]
[[text: Party B | Company]]
[[sign: Party B]]
[[date: Party B]]
`,
  },
  {
    id: "services", name: "Services agreement", blurb: "Freelance / contractor scope, fees, IP.", signers: ["Client", "Contractor"],
    markdown: `# Services Agreement

**Effective date:** ${today}

## 1. Parties
This Agreement is between **Client** and **Contractor**.

## 2. Services
Contractor will perform the services described in *Schedule A* (the "Services") with professional skill and care.

## 3. Fees & payment
| Item | Amount | Due |
| --- | --- | --- |
| Deposit | 30% | On signing |
| Milestone | 40% | On delivery of draft |
| Final | 30% | On acceptance |

Invoices are payable within **14 days**.

## 4. Intellectual property
On full payment, all deliverables are assigned to Client. Contractor retains pre-existing materials and general know-how.

## 5. Confidentiality
Each party keeps the other's non-public information confidential during and for two years after this Agreement.

## 6. Termination
Either party may terminate on 14 days' written notice. Client pays for work completed to the termination date.

## 7. Signatures

[[check: Client | I have reviewed Schedule A and accept the fee schedule]]

[[text: Client | Billing address]]
[[sign: Client]]
[[date: Client]]

[[text: Contractor | Business name]]
[[sign: Contractor]]
[[date: Contractor]]

---

### Schedule A — Scope
- Deliverable 1
- Deliverable 2
`,
  },
  {
    id: "consent", name: "Consent & release", blurb: "Single-signer permission form.", signers: ["Participant"],
    markdown: `# Consent and Release

I, the undersigned, consent to the activity described below and release the organiser from claims arising from my voluntary participation.

## Activity
Describe the activity, date and location here.

## Acknowledgements
[[check: Participant | I have read and understood this document]]
[[check: Participant | I am participating voluntarily]]
[[check: Participant | I am 18 or older, or a guardian is signing on my behalf]]

[[text: Participant | Emergency contact (name and phone)]]
[[initials: Participant]]

## Signature

[[sign: Participant]]
[[date: Participant]]
`,
  },
  {
    id: "offer", name: "Offer letter", blurb: "Employment offer with acceptance block.", signers: ["Candidate"],
    markdown: `# Offer of Employment

**Date:** ${today}

Dear Candidate,

We are pleased to offer you the position of **Role** at **Company**, reporting to **Manager**.

## Terms
- **Start date:** TBD
- **Compensation:** $000,000 per year, paid monthly
- **Location:** Remote
- **Equity:** 0 options, 4-year vest, 1-year cliff

This offer is contingent on satisfactory reference checks and is at-will.

## Acceptance
By signing below you accept this offer on the terms above.

[[sign: Candidate]]
[[date: Candidate]]
`,
  },
];
