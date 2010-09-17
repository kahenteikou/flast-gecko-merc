Cu.import("resource://services-sync/util.js");

function run_test() {
  _("Generated passphrase has length 20.");
  let pp = Utils.generatePassphrase();
  do_check_eq(pp.length, 20);

  _("Passphrase only contains a-z.");
  let bytes = [chr.charCodeAt() for each (chr in pp)];
  do_check_true(Math.min.apply(null, bytes) >= 97);
  do_check_true(Math.max.apply(null, bytes) <= 122);

  _("Hyphenated passphrase has 3 hyphens.");
  let hyphenated = Utils.hyphenatePassphrase(pp);
  do_check_eq(hyphenated.length, 23);
  do_check_eq(hyphenated[5], '-');
  do_check_eq(hyphenated[11], '-');
  do_check_eq(hyphenated[17], '-');
  do_check_eq(hyphenated.slice(0, 5) + hyphenated.slice(6, 11)
            + hyphenated.slice(12, 17) + hyphenated.slice(18, 23), pp);

  _("Normalize passphrase recognizes hyphens.");
  do_check_eq(Utils.normalizePassphrase(hyphenated), pp);
  do_check_eq(pp, pp);
}
