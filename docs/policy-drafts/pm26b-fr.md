# PM-26B — Politique d’assistance, d’annulation, de remboursement et de conservation
PROJET — NON PUBLIÉ — NON EN VIGUEUR
Date : 28 octobre 2026. Source : décisions PM-26A du responsable du produit dans la [matrice de décisions](../../GO_LIVE_MATRIX.md). Il s’agit d’une proposition de texte pour une future politique, et non d’une affirmation selon laquelle les procédures ou tâches de suppression fonctionnent déjà. Les droits impératifs restent inchangés.

## 1. Périmètre et informations non définies
Le service est destiné aux personnes de 18 ans ou plus résidant en Suisse ou au Liechtenstein. La première version en production prévoit le paiement par carte et les enchères manuelles ; les enchères automatiques et TWINT restent désactivés. L’identité de l’exploitant, son adresse, le domaine, les contacts d’assistance et de confidentialité, les prestataires et les pays de traitement restent NON DÉFINIS. Ce projet ne sélectionne aucun prestataire.

## 2. Assistance écrite
Une assistance écrite est prévue, avec un objectif de première réponse sous 2 jours ouvrés en semaine. Il s’agit d’un objectif de première réponse, pas d’une garantie de résolution. Aucune assistance téléphonique ou disponibilité 24 h/24 et 7 j/7 n’est promise. Des informations de suivi doivent être fournies pendant l’examen d’un paiement ou d’un litige. Le responsable, le canal de contact effectif, le calendrier de travail, les délais de résolution et l’escalade restent NON DÉFINIS.

## 3. Annulation de la vente du véhicule et frais de service
Le prix du véhicule est distinct des frais de service de la plateforme de CHF 30. L’annulation d’une vente et le remboursement de ces frais sont deux décisions distinctes. La libération d’une réservation non débitée diffère du remboursement d’une somme déjà débitée. L’acheteur gagnant paie les frais de CHF 30 lorsque la vente aboutit.
- Lorsqu’un acheteur est surenchéri, sa réservation est libérée.
- En cas d’annulation imputable au vendeur, de retrait d’une annonce non conforme ou d’erreur de la plateforme, les frais ne sont pas facturés à l’acheteur ; s’ils l’ont déjà été, ils sont examinés et remboursés.
- Les débits doubles ou erronés sont corrigés.
- La défaillance de l’acheteur ne déclenche pas de débit automatique. Un administrateur examine les motifs et la réponse de l’acheteur. Si la défaillance est confirmée, CHF 30 restent à l’exploitant comme frais de service ; ils ne sont pas versés au vendeur.
- Tant qu’un litige est ouvert, tout débit qui n’a pas encore été effectué est suspendu.

Ces procédures sont prévues pour une mise en œuvre future ; aucun délai bancaire de libération ou de remboursement n’est promis.

## 4. Examen motivé des remboursements
Après une vente réussie, un simple changement d’avis n’entraîne pas automatiquement le remboursement des frais de service selon ce projet. Les erreurs, prestations manquantes et litiges sont examinés selon leurs motifs. Aucune période supplémentaire de remboursement commercial inconditionnel n’a été choisie. Les délais de demande et de décision, les justificatifs, le réexamen après refus, les remboursements partiels et les contestations bancaires restent NON DÉFINIS. La règle du prototype local limitant la procédure à une demande et une décision définitive n’est pas adoptée comme politique de production. Les droits impératifs ne sont pas restreints.

## 5. Objectifs de conservation approuvés
| Catégorie | Objectif |
| --- | --- |
| Correspondance d’assistance clôturée, sauf protection comme preuve | 6 mois après clôture |
| Messages sans lien avec une transaction, sauf protection comme preuve | 6 mois après la dernière activité |
| Journaux techniques et de sécurité, sauf protection comme preuve | 30 jours |
| Sauvegardes | Conservation glissante de 30 jours |

Ce sont des objectifs de politique produit approuvés, pas des délais légaux ni une affirmation de suppression automatique déjà mise en œuvre. La règle d’activité des messages approuvée figure ci-dessous ; les horodatages des journaux et le cycle des sauvegardes restent à documenter.

Règle des messages approuvée PM-26D : la dernière activité est la date la plus récente de création de la conversation, d’un message ou de création/modification d’un rendez-vous. La lecture/consultation ne prolonge pas le délai. Le seuil est de 6 mois calendaires UTC, limité au dernier jour du mois cible. Toute offre, réservation, vente ou tout signalement du véhicule, tout signalement de message ouvert ou clos dans la conversation, ou un rendez-vous en attente/accepté protège tous ses messages. La clôture d’un signalement ou litige ne lève pas automatiquement la protection. Seuls les messages sans ces liens et au-delà du seuil deviennent candidats dans un aperçu en lecture seule ; rien n’est supprimé. Les durées de protection restent NON DÉFINIES. Les horodatages des journaux et le cycle des sauvegardes restent à préciser.

## 6. Exceptions de protection et durées non définies
Les durées de conservation des paiements/transactions, contrats et acceptations, ainsi que des dossiers de litige ouverts ou clos, restent NON DÉFINIES. La correspondance d’assistance, les messages et journaux constituant des preuves de transaction ou de litige sont exclus de la suppression automatique générale. Le périmètre approuvé pour les messages figure ci-dessus ; les autres périmètres et les durées non définies nécessitent une décision séparée. Une durée non définie ne vaut pas accord de conservation indéfinie.
Fermer un compte n’implique pas la suppression immédiate de toutes les données de transaction. Aucune durée n’est attribuée ici aux comptes, médias ou autres catégories non citées. Le choix entre suppression et anonymisation, le réexamen de la protection et le maintien des demandes de suppression après restauration d’une sauvegarde doivent être précisés avant mise en œuvre.

## 7. Publication et mise en œuvre
Les informations sur l’exploitant, les contacts et les prestataires, les décisions restantes et l’examen du texte final doivent être achevés avant publication. Ces projets ne constituent pas une version juridique active et ne demandent aucune acceptation aux utilisateurs. Ce document n’active aucune suppression planifiée, opération de paiement ou remboursement. Le [plan de mise en œuvre](../../RETENTION_PROTECTION_PLAN.md) distinct décrit les limites techniques.
