# Maison · Énergie

Première version du tableau de bord pour la maison de Guigui. L’interface ouvre une **démonstration explicitement signalée**. Aucune IP privée n’a pu être contactée depuis sa création, et aucun Google Sheet n’a été créé ni relié à votre compte.

## Ce qui est prêt

- Puissance maison, production photovoltaïque et échange réseau en W / kW ; lecture visée toutes les 2 secondes, selon le réseau et les réponses Shelly.
- Schéma animé : solaire, maison, achat au réseau ou injection du surplus.
- Couverture solaire instantanée ; les appareils sont déjà compris dans le total maison et ne sont pas additionnés une seconde fois.
- Piscine, pompe à chaleur et chauffe-eau affichés discrètement en direct, avec leur propre historique.
- Histogramme en **kWh par barre** : minute, 15 minutes, heure, jour, mois ou année. Date, période précédente/suivante, détail au survol ou au clavier.
- Portail à `192.168.1.114` : modes voiture et piéton, avec des impulsions fixées à **0,5 seconde**. Garage à `192.168.1.10` : bouton d’impulsion. Sans contact de position, l’état reste inconnu.
- Carte Recharge VE préconfigurée pour lire le booléen `boolean:200` sur le Shelly du garage (`192.168.1.10`), avec ses libellés OFF/On.

## 1. Vérifier les voies et la mesure maison

Les affectations ci-dessous sont des **hypothèses à vérifier**, pas des voies déjà identifiées.

| Mesure | IP fournie | Canal proposé |
|---|---|---|
| Photovoltaïque | 192.168.1.15 | 0 |
| Maison | 192.168.1.11 | 0 |
| Piscine | 192.168.1.11 | 1 |
| Pompe à chaleur | 192.168.1.17 | 0 |
| Chauffe-eau | 192.168.1.17 | 1 |

Le canal API **0** est la première voie ; **1**, la seconde. Dans les réglages, « Tester les mesures » ne fait que lire les compteurs. Vérifiez les deux voies en comparant avec Shelly, notamment quand un appareil connu fonctionne. Le fait que la piscine soit à zéro ne permet pas à lui seul d’identifier sa voie.

Si nécessaire, depuis le Wi-Fi maison, ouvrez dans le navigateur :

- [Informations du Shelly photovoltaïque](http://192.168.1.15/shelly)
- [Informations du Shelly maison et piscine](http://192.168.1.11/shelly)
- [Informations du Shelly PAC et chauffe-eau](http://192.168.1.17/shelly)

Pour les mesures : `/status` sur Gen 1, `/rpc/Shelly.GetStatus` sur Gen 2/3/4. La lecture couvre `emeters`, `meters`, `em1`, `switch` et `pm1`. Les compteurs triphasés `em` et les appareils protégés par authentification nécessitent une adaptation à leur modèle ; les résultats JSON permettront de la faire. Ne communiquez aucun mot de passe.

Deux modes existent pour la pince maison :

| Emplacement réel | Choix dans les réglages | Calcul |
|---|---|---|
| Tous les usages de la maison, production exclue | Consommation totale (`load`) | Réseau = consommation − production |
| Arrivée réseau, après prise en compte de la production | Échange réseau (`grid`) | Consommation = production + réseau signé |

En mode réseau, **achat positif, injection négative**. Utilisez « Inverser » si le sens de la pince donne le signe contraire. Ne prenez pas la valeur absolue d’une mesure réseau. Si la pince ne mesure qu’une partie de la maison, ces calculs ne sont pas valables : il faut préciser le câblage avant de valider.

## 2. Ouvrir le tableau de bord chez soi

La version hébergée en HTTPS permet de consulter la démonstration et, une fois configuré, l’historique Google. Elle n’est pas une passerelle vers le réseau privé de la maison.

**Option directe :** ouvrir `dist/maison-energie.html`, un fichier autonome, sur le Wi-Fi de la maison ; ouvrir les réglages, vérifier les voies, choisir le mode maison puis passer en direct. L’accès aux appareils HTTP dépend du navigateur et du firmware Shelly. Si le navigateur le propose, autoriser l’accès au réseau local. Aucune requête à vos appareils n’est faite en mode démo.

**Si la lecture directe est bloquée par le navigateur :** le kit contient un serveur local facultatif, sans dépendance Python à installer. Avec Python 3.10 ou plus, ouvrir un terminal dans le dossier extrait et lancer :

```bash
python demarrer.py
```

Puis ouvrir [le tableau de bord local](http://127.0.0.1:8765). Ce serveur ne fonctionne que sur cet ordinateur ; il permet les lectures et impulsions sans CORS. Il n’a pas besoin de rester allumé pour l’historique : c’est le Shelly collecteur qui enregistre. Il ne fournit ni accès distant ni relais cloud. L’authentification des appareils n’est pas implémentée dans ce premier kit ; si elle est active, on adapte la connexion au modèle, sans la désactiver.

## 3. Préparer Google Sheets

1. Créer un **nouveau** Google Sheet, nommé par exemple « Maison – Énergie ».
2. Ouvrir **Extensions → Apps Script** et coller le contenu de `integration/Google-Apps-Script.gs` dans `Code.gs`.
3. Utiliser le moteur V8. Le fichier `integration/appsscript.json` fournit les paramètres et autorisations nécessaires si vous affichez le manifeste dans les réglages du projet.
4. Exécuter `initialiser` une fois et accepter les autorisations de votre propre script. Un déclencheur d’entretien horaire est créé.
5. Dans **Paramètres du projet → Propriétés du script**, récupérer `READ_TOKEN` et `WRITE_TOKEN`. Elles sont différentes : **lecture** pour l’interface, **écriture** uniquement pour le Shelly collecteur. Ne pas les publier.
6. **Déployer → Nouveau déploiement → Application Web** : exécuter en tant que vous, accès « Tout le monde ». L’API vérifie les clés sur chaque requête ; le Google Sheet lui-même n’a pas besoin d’être partagé publiquement. Certains comptes professionnels interdisent ce déploiement ; il faut alors adapter l’architecture.
7. Copier l’URL qui se termine par `/exec` dans les réglages du tableau de bord, avec `READ_TOKEN`.

Une modification ultérieure du code nécessite de mettre à jour le déploiement Apps Script. Une réponse vide ou « clé incorrecte » ne signifie pas une consommation nulle : le graphique l’indique comme une erreur.

## 4. Installer le collecteur sur votre Shelly qui accepte les scripts

Utiliser **un seul collecteur pour les cinq mesures**. Aucun Home Assistant ni ordinateur allumé en permanence n’est nécessaire. Le Shelly choisi doit rester alimenté, connecté au Wi-Fi, à Internet et avoir son horloge synchronisée.

1. Ouvrir `integration/collecteur-shelly.js` et modifier uniquement le bloc `CFG` en tête de fichier : URL `/exec`, `WRITE_TOKEN`, `topology`, générations, canaux et éventuelle inversion. Conserver l’ordre solaire, maison, piscine, PAC, chauffe-eau.
2. Recopier exactement les mêmes affectations que dans l’interface. Après vérification, mettre `confirmed: true`. Ce garde-fou empêche un enregistrement fondé sur des canaux supposés.
3. Coller le script dans la rubrique **Scripts** du Shelly compatible. Enregistrer, activer le lancement au démarrage et démarrer.
4. Attendre environ 5 minutes. Un onglet `mAAAAMMJJ` doit apparaître dans Google Sheets. Le journal du script indique « Google OK ». Si rien n’arrive, transmettre le message d’erreur et le modèle/firmware, sans les clés.

Le collecteur ne commande **aucun relais** et ne change aucun paramètre matériel. Les HTTP sont séquentiels par appareil pour limiter les appels simultanés. Les modèles/firmwares exacts, la mémoire disponible, l’authentification et le suivi des redirections HTTPS Google restent à vérifier sur votre matériel.

## Fréquence, capacité et qualité des statistiques

| Fonction | Fonctionnement prévu |
|---|---|
| Affichage direct | Lecture des trois IP toutes les 2 s quand l’interface est visible |
| Collecte indépendante | Un cycle de lecture toutes les 5 s sur le Shelly collecteur |
| Donnée enregistrée | Une ligne par minute, avec cinq mesures, achat/injection et durées réellement couvertes |
| Envoi Google | Un lot toutes les 5 min, donc **288 envois par jour** en régime normal ; redirections HTTP éventuelles en plus |
| Minute | Au moins 30 jours de détail |
| 15 min et heure | Environ deux ans de détail, obtenu par agrégation |
| Jour, mois, année | Résumés journaliers conservés, à partir desquels les vues sont calculées |

Les 15 colonnes utilisent environ **648 000 cellules pour 30 jours à la minute**, puis **1 051 200 cellules pour deux années de 15 minutes** (calcul de capacité volontairement conservateur, avant recouvrement et allocation des onglets). Les résumés journaliers ajoutent environ 5 475 cellules par an. On évite ainsi de garder indéfiniment les 525 600 lignes annuelles à la minute.

L’API Google Apps Script reçoit les relevés **poussés par le Shelly** : elle ne peut pas appeler vos IP privées. Le quota `UrlFetchApp` concerne les requêtes sortantes depuis Apps Script et ne représente donc pas le nombre autorisé de webhooks entrants. Les quotas de durée, concurrence et service Google continuent de s’appliquer ; 288 envois/jour n’est pas une garantie de disponibilité.

Les kWh sont **estimés par intégration des puissances échantillonnées**, et ne sont pas une lecture des index d’énergie facturés. L’intégration respecte le temps réellement écoulé, découpe les minutes et ne prolonge pas une valeur au-delà d’une interruption de 15 s. Les passages achat/injection entre deux échantillons peuvent introduire une petite erreur. Un écart avec le compteur fournisseur reste possible. Une précision renforcée à partir des index Wh des Shelly pourra être ajoutée après identification de leurs modèles.

Une mesure absente produit une durée couverte nulle et une barre manquante, pas zéro kWh. Les périodes partielles apparaissent atténuées ; le détail indique leur couverture. L’heure de Paris est utilisée pour les journées, mois et années, avec les journées de 23 h et 25 h lors des changements d’heure.

Le collecteur garde **30 minutes en mémoire vive** en cas d’échec Google et réessaie sans doubler les minutes déjà reçues. Au-delà, les plus anciennes minutes sont perdues. Un redémarrage du collecteur perd cette file et la minute en cours. Aucun relevé n’est reconstruit artificiellement pendant la panne. Un stockage durable supplémentaire serait nécessaire pour garantir la conservation lors de longues coupures.

## 5. Portail et garage

Les IP sont préremplies : **portail `192.168.1.114`**, **garage `192.168.1.10`**. Le canal proposé est toujours 0, à vérifier. La génération peut être détectée en lecture avec `/shelly`, ou choisie manuellement. La durée du portail est fixée à **0,5 seconde**, comme votre bouton actuel. Le garage conserve son propre réglage.

| Mode du portail | Impulsions | Fermeture |
|---|---|---|
| Voiture | Une impulsion de 0,5 s | Gérée uniquement par la motorisation ; aucune autre impulsion programmée |
| Piéton | 0,5 s à t=0, puis à t=5 s, puis à t=35 s | Troisième impulsion 30 s après la deuxième |

Le mode piéton est à lancer **portail fermé**. Une ouverture de cinq secondes ne mesure pas physiquement une demi-course : c’est l’arrêt temporisé demandé, à valider sur votre portail. Aucune position ouverte ou fermée n’est déduite du relais. Le comportement ouverture → arrêt → fermeture et les interactions avec la fermeture automatique interne doivent être vérifiés sur votre motorisation.

### Installer la séquence sur le Shelly

Le fichier **`integration/portail-shelly.js`** contient le contrôleur des deux modes. Il s’exécute sur un Shelly compatible Scripts et HTTPServer : de préférence celui du portail s’il est compatible, sinon un autre Shelly alimenté de la maison. Un Shelly Gen 1 ne peut pas héberger ce script ; il peut être commandé par le Shelly qui l’héberge. Ce script est indépendant du collecteur d’énergie : conserver les deux scripts séparés.

1. Dans le tableau de bord, ouvrir Réglages → Portail et garage → Générer une clé. Copier la clé privée dans le champ `PORTAIL.token` du script. Ne pas la partager.
2. Vérifier `PORTAIL.channel` et conserver l’IP `192.168.1.114`. Choisir `transport: "local"` uniquement si le script s’exécute sur **le Shelly du portail à cette IP** ; il utilise alors ses appels internes et vérifie l’IP de l’appareil. Si le script est installé sur un autre Shelly, laisser `transport: "auto"` pour détecter Gen 1 ou Gen 2/3/4, ou choisir `"1"` / `"2"` après identification.
3. Après vérification du contact sec et de l’arrêt automatique de 0,5 s, mettre `PORTAIL.confirmed: true`. Installer, enregistrer et démarrer le script ; activer le démarrage automatique. **Le démarrage du script n’envoie aucune impulsion.**
4. Noter l’ID du script affiché dans Shelly. Dans le tableau de bord, renseigner `http://IP_DU_SHELLY_QUI_HEBERGE_LE_SCRIPT/script/ID/gate` et la même clé. L’IP du script n’est pas nécessairement celle du portail.
5. Valider les relais dans les réglages puis enregistrer. La configuration des accès peut être enregistrée même si les compteurs d’énergie ne sont pas encore validés. Le mode piéton s’active seulement si le contrôleur est joignable, configuré et cible bien l’IP et le canal du portail.

Sans contrôleur configuré, le mode voiture reste une commande directe unique de 0,5 s ; le mode piéton réel reste désactivé. Avec le contrôleur configuré, **les deux modes passent par lui**, ce qui empêche leur chevauchement depuis ce tableau de bord, même entre plusieurs onglets. Il n’existe aucun repli automatique sur une commande directe si le contrôleur est injoignable. Les commandes envoyées depuis l’application Shelly, une télécommande ou un autre système ne peuvent toutefois pas être détectées comme un changement de position : ne pas les mêler à la séquence piéton.

### Avancement, annulation et interruptions

Les échéances sont calculées à partir de l’émission de chaque impulsion : arrêt 5 s après la première, puis fermeture 30 s après la deuxième. La durée de chaque impulsion est gérée par le relais lui-même (`timer=0.5` ou `toggle_after=0.5`). Si le contrôleur est sur un autre appareil, une petite latence réseau peut déplacer les échéances. Si une impulsion prévue est retardée de plus d’une seconde ou n’est pas confirmée, les suivantes sont annulées ; aucune impulsion n’est retentée automatiquement.

Fermer l’onglet ou le navigateur n’arrête pas une séquence acceptée par le Shelly. Le tableau de bord relit son avancement quand il est rouvert. Le bouton **Annuler les impulsions restantes** supprime les prochaines étapes ; **il n’arrête pas un portail déjà en mouvement**. Une commande déjà émise ne peut pas être rappelée.

Une coupure d’alimentation ou l’arrêt/redémarrage du script efface ses temporisations. Il n’envoie alors **aucune impulsion de reprise**, car la position est inconnue ; la fermeture piéton n’est donc pas garantie dans ce cas. Vérifier le portail sur place avant de lancer une nouvelle séquence. Conserver les protections matérielles de la motorisation. Aucun essai d’ouverture réel n’a été fait dans cette livraison.

Les endpoints HTTPServer héritent de l’authentification Shelly lorsqu’elle est activée. L’authentification Digest de l’appareil n’est pas implémentée dans cette première intégration ; si elle est active, il faut adapter la connexion sans désactiver cette protection. Le firmware doit prendre en charge les API Scripts, Timer, HTTPServer et `Shelly.getUptimeMs` utilisées ici.

## 6. Composant virtuel

Le composant existant est préconfiguré ; aucune capture supplémentaire n’est nécessaire :

| Réglage | Valeur |
| --- | --- |
| Nom | Recharge VE |
| Shelly hôte | Garage — `192.168.1.10` |
| Identifiant | `boolean:200` |
| Valeur `false` | Recharge VE OFF |
| Valeur `true` | Recharge VE On |

En mode Direct local, la carte lit `/rpc/Boolean.GetStatus?id=200` toutes les 2 secondes, indépendamment des mesures d’énergie. Ouvrir la dernière interface HTML téléchargée ou le lanceur local sur le réseau de la maison, puis choisir Enregistrer et passer en direct dans les réglages. Aucun script supplémentaire n’est nécessaire pour cette lecture. Les paramètres de la carte et ses deux libellés restent modifiables dans Réglages → Mon composant virtuel.

Selon vos réglages Shelly, la valeur par défaut est OFF et la valeur actuelle est conservée après redémarrage. Le tableau de bord affiche la valeur réellement renvoyée par le Shelly : il n’utilise pas le défaut OFF comme mesure, ne recrée pas le composant et ne change pas sa persistance. En démonstration ou en cas d’échec de lecture, aucun état ON/OFF n’est inventé. Les réglages d’icône et de journal d’événements n’empêchent pas cette lecture.

Cette carte affiche l’état du booléen en lecture seule ; elle ne mesure pas la puissance de recharge et ne commande pas la borne. Cette version ne l’enregistre pas dans l’historique énergétique Google Sheets. Les types texte, nombre et liste restent pris en charge si vous reconfigurez la carte pour un autre composant.

## Vérifications de cette livraison

La syntaxe et les calculs sont vérifiés sur des réponses simulées : lecture Gen 1/EM1/Switch, vraies valeurs à zéro, import/export, absence de données, calcul des Wh, changements d’heure, agrégation et absence de doublons lors d’une reprise d’archivage. Les tests ne contactent aucun appareil ni Google. La connexion physique, les scripts dans le firmware Shelly, les commandes et le déploiement Apps Script restent à valider chez vous. Aucun test dans un navigateur réel n’a été réalisé dans cet environnement.

Les tests du portail utilisent une horloge simulée et le code réellement livré : une seule impulsion en voiture, trois à 0/5/35 s en piéton, durée 0,5 s dans les appels Shelly, refus des doubles commandes, annulation, perte de confirmation et arrêt de la suite en cas d’erreur. Les tests des composants virtuels vérifient que seules les méthodes de lecture et les IDs virtuels 200–299 sont autorisés.

## Documentation officielle consultée

- [Shelly Gen 1 — API et compteurs EM](https://shelly-api-docs.shelly.cloud/gen1/)
- [Shelly EM1 — mesure de puissance](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/EM1/)
- [Shelly Switch — commandes et temporisation](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Switch/)
- [Shelly HTTP — appels depuis les scripts](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/HTTP/)
- [Shelly HTTPServer — endpoints du script portail](https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/HTTPServer/)
- [Shelly Timer — temporisations et redémarrages](https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Timer/)
- [Shelly — composants virtuels](https://shelly-api-docs.shelly.cloud/gen2/DynamicComponents/Virtual/)
- [Google Apps Script — quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [Google Apps Script — réponses JSON et redirections](https://developers.google.com/apps-script/guides/content)
- [Google Drive — limites des fichiers Google Sheets](https://support.google.com/drive/answer/37603?hl=fr)
