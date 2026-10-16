/* Offline protocol-library fixture: no production endpoints or credentials. */
#include <openconnect.h>
#include <stdlib.h>
#include <unistd.h>
#include <string.h>
static openconnect_process_auth_form_vfn callback;
static openconnect_validate_peer_cert_vfn cert;
struct openconnect_info *openconnect_vpninfo_new(const char *a,openconnect_validate_peer_cert_vfn b,openconnect_write_new_config_vfn c,openconnect_process_auth_form_vfn d,openconnect_progress_vfn e,void *f){(void)a;(void)c;(void)e;(void)f;cert=b;callback=d;return (void*)1;}
int openconnect_get_port(struct openconnect_info *v){(void)v;return 443;}
int openconnect_init_ssl(void){return 0;}
void openconnect_vpninfo_free(struct openconnect_info *v){(void)v;close(0);}
void openconnect_set_system_trust(struct openconnect_info *v,unsigned n){(void)v;(void)n;}
int openconnect_set_protocol(struct openconnect_info *v,const char *p){(void)v;const char *supported[]={"anyconnect","nc","pulse","gp","f5","fortinet","array",NULL};for(int i=0;supported[i];i++)if(!strcmp(p,supported[i]))return 0;return -1;}
int openconnect_parse_url(struct openconnect_info *v,const char *p){(void)v;return strcmp(p,"https://example.com/");}
const char *openconnect_get_dnsname(struct openconnect_info *v){(void)v;return "example.com";}
const char *openconnect_get_hostname(struct openconnect_info *v){(void)v;return "192.0.2.1";}
const char *openconnect_get_cookie(struct openconnect_info *v){(void)v;return "fictional-cookie";}
int openconnect_set_option_value(struct oc_form_opt *o,const char *s){o->_value=strdup(s);return 0;}
int openconnect_obtain_cookie(struct openconnect_info *v){
 (void)v;if(getenv("MOCK_BAD_CERT"))return cert(NULL,"invalid certificate");
 struct oc_choice first={.name="employees",.label="Employees"},second={.name="guests",.label="Guests"};struct oc_choice *choices[]={&first,&second};
 struct oc_form_opt_select group={.form={.type=OC_FORM_OPT_SELECT,.name="group_list",.label="GROUP:"},.nr_choices=2,.choices=choices};
 struct oc_auth_form form={.opts=&group.form,.authgroup_opt=&group};
 int result=callback(NULL,&form);if(result!=OC_FORM_RESULT_NEWGROUP)return result;
 if(!group.form._value || strcmp(group.form._value,"employees"))return -1;
 struct oc_form_opt password={.type=OC_FORM_OPT_PASSWORD,.name="password",.label="Password:"};struct oc_form_opt user={.next=&password,.type=OC_FORM_OPT_TEXT,.name="username",.label="Username:"};group.form.next=&user;
 result=callback(NULL,&form);if(result)return result;
 if(!user._value || !password._value || strcmp(user._value,"fictional-user") || strcmp(password._value,"fictional-secret"))return -1;
 free(user._value);free(password._value);return 0;
}
